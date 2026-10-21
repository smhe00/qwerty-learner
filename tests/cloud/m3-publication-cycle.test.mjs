import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-publication-'))
const output = join(tmp, 'cycle.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/m3-publication-cycle.ts')],
  outfile: output, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { runM3PublicationCycle: run } = await import(pathToFileURL(output).href)

test('M3: two bounded batches may publish but cannot claim all-device sync', async () => {
  let published = 0
  const port = {
    async assertOwner() {},
    async recover() { return { scanned: 98, pending: 98 } },
    async publish() {
      published++
      return { status: 'verified', receipt: {}, remaining: published === 1 ? 66 : 34 }
    },
  }
  const x = await run(port)
  assert.deepEqual(x, {
    status: 'uploaded-events-only', scanned: 98, batches: 2, remaining: 34,
  })
  assert.equal(published, 2)
  assert.ok(!('convergenceComplete' in x))
})

test('M4: stale or failed readback keeps in-flight evidence, never retries with new batch', async () => {
  let calls = 0
  const x = await run({
    async assertOwner() {},
    async recover() { return { scanned: 2, pending: 2 } },
    async publish() {
      calls++
      return { status: 'retained', reason: 'event-readback-temporarily-invisible' }
    },
  })
  assert.deepEqual(x, { status: 'blocked', reason: 'event-readback-temporarily-invisible' })
  assert.equal(calls, 1)
})

test('M4: ownership changes during upload never report a completed cycle', async () => {
  let checks = 0
  const x = await run({
    async assertOwner() {
      if (++checks >= 4) throw new Error('account-changed')
    },
    async recover() { return { scanned: 2, pending: 2 } },
    async publish() { return { status: 'verified', receipt: {}, remaining: 0 } },
  })
  assert.deepEqual(x, { status: 'blocked', reason: 'account-changed' })
})

test('M4: offline and invalid recovery fail closed before any publication', async () => {
  let published = 0
  const x = await run({
    async assertOwner() {},
    async recover() { throw new Error('offline-retained') },
    async publish() { published++; return { status: 'idle' } },
  })
  assert.deepEqual(x, { status: 'blocked', reason: 'offline-retained' })
  assert.equal(published, 0)
  const y = await run({
    async assertOwner() {},
    async recover() { return { scanned: -1, pending: 0 } },
    async publish() { published++; return { status: 'idle' } },
  })
  assert.equal(y.status, 'blocked')
  assert.equal(published, 0)
  assert.equal((await run({
    async assertOwner() {},
    async recover() { throw new Error('must-not-run') },
    async publish() { throw new Error('must-not-run') },
  }, 5)).status, 'blocked')
})

test('M3: completed local outbox remains idle and never reports synced', async () => {
  const x = await run({
    async assertOwner() {},
    async recover() { return { scanned: 12, pending: 0 } },
    async publish() { return { status: 'idle' } },
  })
  assert.deepEqual(x, { status: 'idle', scanned: 12 })
})
