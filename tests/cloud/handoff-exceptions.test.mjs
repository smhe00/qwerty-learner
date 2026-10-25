/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { PausableBlob } from './session-handoff-fixtures.mjs'
import { qualifyExceptionalHandoff } from './handoff-exceptions.mjs'

test('expanded handoff journey through actual gateway and real TCP client disconnect', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handoff-exceptions-'))
  const stores = new Map(), handlers = new Set()
  globalThis.__exceptionBlob = options => {
    if (!stores.has(options.name)) stores.set(options.name, new PausableBlob())
    return stores.get(options.name)
  }
  const outfile = join(directory, 'gateway.mjs')
  let server
  try {
    await build({ entryPoints: ['cloud-functions/api/[[default]].js'], outfile,
      bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', plugins: [{
        name: 'test-blob', setup(builder) {
          builder.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'blob', namespace: 'test' }))
          builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: 'export const getStore = options => globalThis.__exceptionBlob(options)', loader: 'js',
          }))
        },
      }] })
    const { onRequest } = await import(pathToFileURL(outfile))
    server = createServer((incoming, outgoing) => {
      const work = (async () => {
        const parts = []
        for await (const chunk of incoming) parts.push(chunk)
        const bytes = Buffer.concat(parts)
        const request = new Request('https://internal.invalid' + incoming.url, {
          method: incoming.method, headers: incoming.headers,
          ...(bytes.length ? { body: bytes } : {}),
        })
        // Do not terminate server work when its client drops the response.
        const response = await onRequest({ request, clientIp: '192.0.2.201', env: { branch: 'etest', AUTH_RATE_LIMIT_REQUESTS: '1000' } })
        if (!outgoing.destroyed) {
          outgoing.writeHead(response.status, Object.fromEntries(response.headers))
          outgoing.end(Buffer.from(await response.arrayBuffer()))
        }
      })()
      handlers.add(work)
      work.then(() => handlers.delete(work), () => { handlers.delete(work); outgoing.destroy() })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let nativeAborts = 0
    const report = await qualifyExceptionalHandoff({ fetchImpl: async (target, options) => {
      assert.equal(target.origin, 'https://t.smhe.cn')
      const local = new URL(target.pathname + target.search, `http://127.0.0.1:${server.address().port}`)
      try { return await fetch(local, options) }
      catch (error) { if (error.name === 'AbortError') nativeAborts++; throw error }
    } })
    assert.equal(report.passed, true, JSON.stringify(report.failure))
    assert.equal(nativeAborts, 1)
    assert.equal(report.abortedWriteReplays, 0)
    assert.equal(report.cleanup, 'synthetic-account-deleted')
    assert.ok(report.checkpoints.some(s => s.pendingHandoffs === 2 && s.heldWriters === 1))
    assert.ok(report.checks.length >= 25)
    const text = JSON.stringify(report)
    assert.doesNotMatch(text, /qs1\.|qh26[0-9a-f]{24}|"password"|"token"|"username"/)
  } finally {
    await Promise.allSettled([...handlers])
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    delete globalThis.__exceptionBlob
    await rm(directory, { recursive: true, force: true })
  }
})
