import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m3-repair-'))
const path = join(dir, 'pump.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/m3-continuous-drain.ts')],
  outfile: path, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { startM3ContinuousDrain } = await import(pathToFileURL(path).href)

function clock(results) {
  let now = 0, online = true, stopped = false, onConnect = null,
    onVisible = null, calls = 0
  const log = [], pending = new Map()
  let next = 1
  const port = {
    run: async () => {
      calls++
      const result = results.shift()
      if (result instanceof Error) throw result
      return result ?? { status: 'idle', scanned: 0 }
    },
    schedule: (callback, ms) => {
      const id = next++
      pending.set(id, { callback, at: now + ms })
      return id
    },
    cancel: handle => { pending.delete(handle) },
    isOnline: () => online,
    onOnline: callback => { onConnect = callback; return () => { onConnect = null } },
    onVisible: callback => { onVisible = callback; return () => { onVisible = null } },
    log: message => log.push(message),
  }
  return {
    port, log, pending,
    get calls() { return calls },
    get nextDelay() { return Math.min(...[...pending.values()].map(x => x.at - now)) },
    async advance(ms) {
      now += ms
      const due = [...pending.entries()].filter(([, task]) => task.at <= now)
      for (const [id, task] of due) { pending.delete(id); task.callback() }
      await new Promise(done => setImmediate(done))
    },
    offline() { online = false },
    online() { online = true; onConnect?.() },
    visible() { onVisible?.() },
    close() { stopped = true },
    get stopped() { return stopped },
  }
}
test('outbox automatically rescans after crash and drains multiple bounded batches', async () => {
  const f = clock([
    { status: 'uploaded-events-only', scanned: 100, batches: 2, remaining: 36 },
    { status: 'uploaded-events-only', scanned: 100, batches: 2, remaining: 0 },
    { status: 'idle', scanned: 100 },
  ])
  const stop = startM3ContinuousDrain(f.port)
  assert.equal(f.nextDelay, 2000)
  await f.advance(2000)
  assert.equal(f.calls, 1)
  assert.equal(f.nextDelay, 1000)
  await f.advance(1000)
  assert.equal(f.calls, 2)
  assert.equal(f.nextDelay, 45000)
  await f.advance(45000)
  assert.equal(f.calls, 3)
  stop()
  assert.equal(f.pending.size, 0)
})
test('offline retains all evidence; online wakes without user action', async () => {
  const f = clock([{ status: 'idle', scanned: 1 }])
  f.offline()
  const stop = startM3ContinuousDrain(f.port)
  await f.advance(2000)
  assert.equal(f.calls, 0)
  assert.equal(f.nextDelay, 60000)
  f.online()
  assert.equal(f.nextDelay, 1000)
  await f.advance(1000)
  assert.equal(f.calls, 1)
  stop()
})
test('uncertain upload response never retries immediately or claims convergence', async () => {
  const f = clock([
    { status: 'blocked', reason: 'remote-commit-ambiguous' },
    { status: 'blocked', reason: 'remote-commit-ambiguous' },
    { status: 'idle', scanned: 5 },
  ])
  const stop = startM3ContinuousDrain(f.port)
  await f.advance(2000)
  assert.equal(f.nextDelay, 7500)
  await f.advance(7500)
  assert.equal(f.nextDelay, 15000)
  await f.advance(15000)
  assert.equal(f.nextDelay, 45000)
  assert.equal(f.log.length, 2)
  stop()
})
test('repeated visible events coalesce to a single pending rescan', async () => {
  const f = clock([{ status: 'idle', scanned: 0 }])
  const stop = startM3ContinuousDrain(f.port)
  f.visible()
  f.visible()
  f.visible()
  assert.equal(f.pending.size, 1)
  await f.advance(1000)
  assert.equal(f.calls, 1)
  stop()
  assert.equal(f.pending.size, 0)
  f.visible()
  f.online()
  assert.equal(f.pending.size, 0)
})
test('pagehide during upload prevents future scheduling and detaches listeners', async () => {
  let resolve
  const pendingUpload = new Promise(done => { resolve = done })
  const f = clock([])
  f.port.run = () => pendingUpload
  const stop = startM3ContinuousDrain(f.port)
  await f.advance(2000)
  stop()
  resolve({ status: 'uploaded-events-only', scanned: 12, batches: 2, remaining: 5 })
  await new Promise(done => setImmediate(done))
  assert.equal(f.pending.size, 0)
})
