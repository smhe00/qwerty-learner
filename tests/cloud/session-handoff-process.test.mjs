/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

// Independent OS processes share ONLY a simple remote get/set/list test store.
// The store has no CAS, locks, login/session awareness or handoff transaction.
// This tests process separation; it is NOT a substitute for real EdgeOne tests.
test('three OS processes coordinate through strong per-key HTTP I/O only', { timeout: 15000 }, async () => {
  const objects = new Map()
  let active = 0, maximum = 0, entries = 0
  const server = createServer(async (request, response) => {
    try {
      let text = ''; for await (const bytes of request) text += bytes
      const body = JSON.parse(text || '{}')
      let result = null
      if (request.url === '/set') objects.set(body.key, body.value)
      else if (request.url === '/get') result = objects.get(body.key) ?? null
      else if (request.url === '/list') result = { blobs: [...objects.keys()]
        .filter(key => key.startsWith(body.prefix)).map(key => ({ key })) }
      else if (request.url === '/enter') { maximum = Math.max(maximum, ++active); entries++ }
      else if (request.url === '/exit') active--
      else throw new Error('unexpected test route')
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result))
    } catch { response.writeHead(500); response.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const moduleUrl = new URL('../../cloud-functions/_shared/session-handoff-blob.js', import.meta.url).href
  const script = `
    import { createBlobHandoffBarrier } from ${JSON.stringify(moduleUrl)};
    const call = async (path, body) => {
      const result = await fetch(${JSON.stringify(base)} + path, { method: 'POST', body: JSON.stringify(body) });
      if (!result.ok) throw new Error('test provider failed'); return result.json();
    };
    const store = { setJSON: (key, value) => call('/set', {key, value}),
      get: key => call('/get', {key}), list: options => call('/list', options) };
    for (let i = 0; i < 2; i++) {
      const gate = createBlobHandoffBarrier({ store, pollMs: 2 });
      await gate.execute('a'.repeat(64), 'handoff', async () => {
        await call('/enter', {}); await new Promise(resolve => setTimeout(resolve, 7)); await call('/exit', {});
      });
    }
  `
  const children = []
  try {
    await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] })
      children.push(child)
      let error = ''; child.stderr.on('data', bytes => { error += bytes })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || `child exit ${code}`)))
    })))
    assert.equal(entries, 6); assert.equal(active, 0); assert.equal(maximum, 1)
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
