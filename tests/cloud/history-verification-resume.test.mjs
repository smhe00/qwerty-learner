import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-history-resume-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const output = join(tmp, 'client.mjs')
await build({ stdin: { contents: `export * from './src/sync/m3-witnessed-receiver';
export * from './src/sync/history-verification-continuation';
export * from './src/sync/learning-sync-diagnostics';
export * from './src/sync/history-sync-notice';`, resolveDir: resolve('.') },
  outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
const { inspectWitnessedDeviceConvergence: inspect, createHistoryContinuation: continuation,
  recordLearningSyncDiagnostic, readLearningSyncDiagnostics, historySyncNotice } = await import(pathToFileURL(output).href)
const clone = x => structuredClone(x)
class Blob {
  objects = new Map()
  async get(key) { return this.objects.has(key) ? clone(this.objects.get(key)) : null }
  async list({ prefix }) { return { blobs: [...this.objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) } }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) throw Error('exists')
    this.objects.set(key, clone(value))
    if (this.loseAck && key.includes('/_history/')) { this.loseAck = false; throw Error('lost acknowledgement') }
  }
  async delete(key) { this.objects.delete(key) }
}
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const device = n => 'qwerty-web-' + id(n)
const row = n => ({ attemptId: id(1000 + n), dict: 'synthetic', word: 'word' + n,
  timeStamp: 1800000000 + n, chapter: -1, timing: [], wrongCount: 0, mistakes: {}, sourceMode: 'learn',
  learnItemKind: 'acquisition' })
const receipt = b => ({ deviceId: b.deviceId, sequence: b.sequence, batchId: b.batchId, sha256: b.sha256 })
async function fixture(count = 20, rowsPerBatch = 1) {
  const blob = new Blob(), storage = createEdgeOneBlobStorage(blob)
  const service = createBackendService({ storage, eventPilotEnabled: true })
  const account = await service.register('history_resume', 'Password123', device(1))
  let head = null
  const rows = []
  for (let n = 1; n <= count; n++) {
    const events = Array.from({ length: rowsPerBatch }, (_, i) => row((n - 1) * rowsPerBatch + i + 1))
    rows.push(...events)
    head = receipt(await service.publishChainedLearningBatch(account.token, { deviceId: device(1), batchId: id(n),
      sequence: n, previous: head ? { batchId: head.batchId, sha256: head.sha256 } : null, events }))
  }
  let reads = 0
  const read = storage.getImmutableChainedBatch.bind(storage)
  storage.getImmutableChainedBatch = (...args) => { reads++; return read(...args) }
  return { blob, storage, service, account, rows, heads: [head], reads: () => reads }
}
function memory() {
  const values = new Map()
  return { values, async read(id) { return clone(values.get(id)) }, async save(id, value) { values.set(id, clone(value)) } }
}
async function client(f, cache, more = {}) {
  let ownership = true
  const port = await continuation({ accountId: f.account.user.userId, generation: 1, heads: f.heads, cache,
    assertOwner: async () => { assert.equal(ownership, true) }, canContinue: () => true,
    verify: cursor => f.service.verifyWitnessedChainSet(f.account.token, { heads: f.heads, segmented: true, cursor }),
    read: async requested => ({ ok: true, ...(await f.service.readChainedLearningBatch(f.account.token, requested)) }),
    ...more,
  })
  return { run: localRecords => inspect({ accountId: f.account.user.userId, heads: f.heads, localRecords, port, allowUnchanged: true }),
    revoke: () => { ownership = false } }
}

test('server pages and client reloads resume exactly, full digest permits unchanged without downloads', async () => {
  const f = await fixture(20), cache = memory()
  const first = await (await client(f, cache)).run(f.rows)
  assert.equal(first.status, 'pending')
  assert.equal(first.verifiedReceipts, 16)
  assert.equal(first.totalReceipts, 20)
  assert.equal(f.reads(), 16)
  assert.equal('remoteEvents' in first, false)
  const next = await (await client(f, cache)).run(f.rows)
  assert.equal(next.status, 'unchanged')
  assert.equal(f.reads(), 20, 'resumption never rereads the first 16 remote batches')
  const again = await (await client(f, cache)).run(f.rows)
  assert.equal(again.status, 'unchanged')
  assert.equal(f.reads(), 20, 'fresh authenticated immutable checkpoint replaces full chain reads')
})

test('downloads resume across documents, but cached corruption cannot pass the final independent digest', async () => {
  const f = await fixture(20), cache = memory()
  assert.equal((await (await client(f, cache)).run([])).status, 'pending')
  const downloading = await (await client(f, cache)).run([])
  assert.equal(downloading.reason, 'verification-download-pending')
  assert.equal(downloading.verifiedReceipts, 16)
  const complete = await (await client(f, cache)).run([])
  assert.equal(complete.status, 'witnessed')
  assert.equal(complete.remoteAttemptCount, 20)
  const saved = cache.values.get(f.account.user.userId)
  Object.values(saved.batches)[0].batch.events[0].word = 'corrupted'
  const corrupt = await (await client(f, cache)).run([])
  assert.equal(corrupt.status, 'blocked')
  assert.equal(corrupt.reason, 'witness-evidence-digest-mismatch')
})

test('server gap is diagnosed; last completed page survives and continuation succeeds once visible', async () => {
  const f = await fixture(20), cache = memory()
  await (await client(f, cache)).run(f.rows)
  const key = [...f.blob.objects.keys()].find(k => k.includes('/event-batches/v2/') && k.includes('/0000000004/'))
  const batch = f.blob.objects.get(key)
  f.blob.objects.delete(key)
  const blocked = await (await client(f, cache)).run(f.rows)
  assert.equal(blocked.reason, 'gap-or-stale-read')
  assert.equal(cache.values.get(f.account.user.userId).verified, 16)
  f.blob.objects.set(key, batch)
  assert.equal((await (await client(f, cache)).run(f.rows)).status, 'unchanged')
})

test('checkpoint is scoped to authenticated account and exact heads; tampering never certifies a subset', async () => {
  const f = await fixture(20)
  const first = await f.service.verifyWitnessedChainSet(f.account.token, { heads: f.heads, segmented: true })
  const other = await f.service.register('different_owner', 'Password123', device(2))
  assert.equal((await f.service.verifyWitnessedChainSet(other.token, { heads: f.heads, segmented: true, cursor: first.cursor })).reason,
    'verification-checkpoint-missing')
  const changed = [{ ...f.heads[0], batchId: id(999) }]
  assert.equal((await f.service.verifyWitnessedChainSet(f.account.token, { heads: changed, segmented: true, cursor: first.cursor })).reason,
    'verification-checkpoint-invalid')
  const key = [...f.blob.objects.keys()].find(k => k.includes('/_history/' + first.cursor + '/0.json'))
  f.blob.objects.get(key).data += ' '
  await assert.rejects(f.service.verifyWitnessedChainSet(f.account.token, { heads: f.heads, segmented: true, cursor: first.cursor }),
    e => e.code === 'verification-checkpoint-invalid')
})

test('revoked token cannot resume; generation change discards local progress', async () => {
  const f = await fixture(20), cache = memory()
  await (await client(f, cache)).run(f.rows)
  const changed = await (await client(f, cache, { generation: 2 })).run(f.rows)
  assert.equal(changed.status, 'pending')
  assert.equal(f.reads(), 32)
  await f.service.login('history_resume', 'Password123', device(1))
  const result = await (await client(f, cache, { generation: 2 })).run(f.rows)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'verification-session-revoked')
})

test('checkpoint writes recover only by exact readback; account deletion removes all checkpoint parts', async () => {
  const f = await fixture(9)
  f.blob.loseAck = true
  const first = await f.service.verifyWitnessedChainSet(f.account.token, { heads: f.heads, segmented: true })
  assert.equal(first.receiptsRead, 8)
  assert.ok([...f.blob.objects.keys()].some(k => k.includes('/_history/')))
  await f.service.deleteAccount(f.account.token, 'Password123')
  assert.equal([...f.blob.objects.keys()].some(k => k.includes('/_history/')), false)
})

test('local persistence failure cannot advertise resumable progress or issue a merge proof', async () => {
  const f = await fixture(9)
  const cache = { read: async () => undefined, save: async () => { throw Error('verification-local-checkpoint-failed') } }
  const result = await (await client(f, cache)).run(f.rows)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'verification-local-checkpoint-failed')
  assert.equal('remoteEvents' in result, false)
})

test('diagnostics retain fixed reasons/counts and strip secrets; UI distinguishes snapshot and history', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }
  recordLearningSyncDiagnostic({ stage: 'm3-witness', status: 'blocked', code: 'gap-or-stale-read' })
  recordLearningSyncDiagnostic({ stage: 'm3-witness', status: 'pending', code: 'verification-in-progress', completed: 16, total: 40 })
  recordLearningSyncDiagnostic({ stage: 'm3-witness', status: 'blocked', code: 'private-token-secret', cursor: 'secret', accountId: 'private' })
  const value = readLearningSyncDiagnostics()
  assert.equal(value.entries[0].code, 'gap-or-stale-read')
  assert.equal(value.entries[1].completed, 16)
  assert.equal(value.entries[2].code, 'unknown')
  assert.doesNotMatch(JSON.stringify(value), /private|secret/)
  assert.match(historySyncNotice(true, { completed: 16, total: 40, reason: 'verification-in-progress' }), /完整学习数据已同步。历史验证已完成 16\/40 批/)
  assert.match(historySyncNotice(false), /同步尚未确认/)
})


test('more than 128 combined receipts completes incrementally without raising per-device discovery limits', async () => {
  const f = await fixture(70)
  f.account = await f.service.login('history_resume', 'Password123', device(2))
  let head = null
  for (let n = 1; n <= 70; n++) {
    const event = row(70 + n)
    f.rows.push(event)
    head = receipt(await f.service.publishChainedLearningBatch(f.account.token, { deviceId: device(2), batchId: id(100 + n),
      sequence: n, previous: head ? { batchId: head.batchId, sha256: head.sha256 } : null, events: [event] }))
  }
  f.heads.push(head)
  assert.equal((await f.service.verifyWitnessedChainSet(f.account.token, { heads: f.heads })).reason, 'verification-budget-exceeded')
  const cache = memory()
  let result
  for (let i = 0; i < 9; i++) {
    result = await (await client(f, cache)).run(f.rows)
    assert.equal(result.status, i < 8 ? 'pending' : 'unchanged')
  }
  assert.equal(result.remoteAttemptCount, 140)
})

test('no network request is made after the startup budget; no ownership change yields a usable prefix', async () => {
  const f = await fixture(20), cache = memory()
  const paused = await (await client(f, cache, { canContinue: () => false })).run(f.rows)
  assert.equal(paused.status, 'pending')
  assert.equal(paused.verifiedReceipts, 0)
  assert.equal(f.reads(), 0)
  let calls = 0
  const changed = await client(f, cache, { assertOwner: async () => { if (++calls > 4) throw Error('verification-owner-changed') } })
  assert.equal((await changed.run(f.rows)).status, 'blocked')
})


test('learning new attempts during verification extends the pinned chain without restarting old pages', async () => {
  const f = await fixture(20), cache = memory()
  assert.equal((await (await client(f, cache)).run(f.rows)).verifiedReceipts, 16)
  const before = f.reads()
  for (let n = 21; n <= 24; n++) {
    const old = f.heads[0]
    f.heads[0] = receipt(await f.service.publishChainedLearningBatch(f.account.token, { deviceId: device(1), batchId: id(n),
      sequence: n, previous: { batchId: old.batchId, sha256: old.sha256 }, events: [row(n)] }))
    f.rows.push(row(n))
  }
  const afterWrites = f.reads()
  assert.ok(afterWrites > before)
  const result = await (await client(f, cache)).run(f.rows)
  assert.equal(result.status, 'unchanged')
  assert.equal(result.remoteAttemptCount, 24)
  assert.equal(f.reads() - afterWrites, 8, 'only four new batches and four unfinished older batches')
})


test('large checkpoint uses bounded Blob chunks and retains the exact independently verified event digest', async () => {
  const f = await fixture(64, 32), cache = memory()
  let result
  for (let i = 0; i < 4; i++) result = await (await client(f, cache)).run(f.rows)
  assert.equal(result.status, 'unchanged')
  assert.equal(result.remoteAttemptCount, 2048)
  assert.ok([...f.blob.objects.keys()].some(k => /\/_history\/.*\/1.json$/.test(k)))
})

test('a new head on a conflicting branch cannot reuse old receipts as a verified extension', async () => {
  const f = await fixture(20), cache = memory()
  await (await client(f, cache)).run(f.rows)
  const old = [...f.blob.objects.values()].find(v => v.schemaVersion === 2 && v.sequence === 18)
  let head = receipt(old)
  for (let n = 19; n <= 21; n++) {
    head = receipt(await f.service.publishChainedLearningBatch(f.account.token, { deviceId: device(1), batchId: id(900 + n),
      sequence: n, previous: { batchId: head.batchId, sha256: head.sha256 }, events: [row(900 + n)] }))
  }
  f.heads[0] = head
  const result = await (await client(f, cache)).run(f.rows)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'verification-device-fork')
})

test('conflicting immutable attempt content across separate pages never completes verification', async () => {
  const f = await fixture(20), cache = memory(), old = f.heads[0]
  f.heads[0] = receipt(await f.service.publishChainedLearningBatch(f.account.token, { deviceId: device(1), batchId: id(21),
    sequence: 21, previous: { batchId: old.batchId, sha256: old.sha256 }, events: [{ ...row(1), word: 'conflict' }] }))
  assert.equal((await (await client(f, cache)).run(f.rows)).status, 'pending')
  const result = await (await client(f, cache)).run(f.rows)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'verification-attempt-conflict')
})
