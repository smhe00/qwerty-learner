/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const clone = x => x === null ? null : JSON.parse(JSON.stringify(x))
class FakeBlob {
  constructor() { this.objects = new Map(); this.ambiguous = false; this.ignoreOnlyIfNew = false }
  async get(key) { return this.objects.has(key) ? clone(this.objects.get(key)) : null }
  async list({ prefix }) { return { blobs: [...this.objects.keys()]
    .filter(key => key.startsWith(prefix) && !this.hiddenKeys?.has(key))
    .map(key => ({ key })) } }
  async setJSON(key, value, opts = {}) {
    if (opts.onlyIfNew && this.objects.has(key) && !this.ignoreOnlyIfNew) {
      throw new Error('object exists')
    }
    this.objects.set(key, clone(value))
    if (opts.onlyIfNew && this.ambiguous) {
      this.ambiguous = false
      throw new Error('response lost after durable write')
    }
  }
  async delete(key) { this.objects.delete(key) }
}
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const device = n => 'qwerty-web-' + uuid(n)
const row = n => ({
  attemptId: uuid(n), dict: 'school', word: 'alpha', timeStamp: 1800000000,
  chapter: -1, timing: [], wrongCount: 0, mistakes: {},
  sourceMode: 'learn', learnItemKind: 'review',
  reviewRatingDecision: { eligible: true, rating: 'good',
    confidence: 1, reasonCodes: ['m3-test'] },
})
const payload = (deviceNum, batchNum, eventNum) =>
  ({ deviceId: device(deviceNum), batchId: uuid(batchNum), events: [row(eventNum)] })
function setup() {
  const blob = new FakeBlob()
  const storage = createEdgeOneBlobStorage(blob)
  const service = createBackendService({ storage, multiSessionEnabled: true,
    eventPilotEnabled: true })
  return { blob, storage, service }
}
test('M3 pilot disabled by default even when independent auth is on', async () => {
  const store = createEdgeOneBlobStorage(new FakeBlob())
  const service = createBackendService({ storage: store, multiSessionEnabled: true })
  const a = await service.register('off_event', 'Password123', 'A')
  await assert.rejects(service.publishLearningBatch(a.token, payload(1, 9, 1)),
    e => e.code === 'not_found')
})
test('two independent devices publish without a shared CAS or overwritten batch', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_multidevice', 'Password123', device(1))
  const b = await service.login('event_multidevice', 'Password123', device(2))
  const [first, second] = await Promise.all([
    service.publishLearningBatch(a.token, payload(1, 9, 1)),
    service.publishLearningBatch(b.token, payload(2, 10, 2)),
  ])
  assert.equal(first.convergenceComplete, false)
  assert.equal(second.convergenceComplete, false)
  assert.notEqual(first.sha256, second.sha256)
  const names = [...blob.objects.keys()].filter(k => k.includes('/event-batches/v1/'))
  assert.equal(names.length, 2)
  const repeat = await service.publishLearningBatch(a.token, payload(1, 9, 1))
  assert.equal(repeat.sha256, first.sha256)
  assert.equal([...blob.objects.keys()].filter(k => k.includes('/event-batches/v1/')).length, 2)
  const read = await service.readLearningBatch(b.token, first)
  assert.equal(read.batch.events[0].attemptId, uuid(1))
  assert.equal(read.convergenceComplete, false)
  await assert.rejects(service.readLearningBatch(b.token, { ...first,
    sha256: '0'.repeat(64) }), e => e.code === 'event_batch_not_visible')
})
test('retry after ambiguous provider ACK preserves exact immutable evidence', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_ambiguous', 'Password123', device(1))
  blob.ambiguous = true
  const result = await service.publishLearningBatch(a.token, payload(1, 11, 2))
  assert.equal(result.stored, true)
  assert.equal((await service.readLearningBatch(a.token, result)).batch.events.length, 1)
})
test('reused batch ID with different event contents cannot replace original batch', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_collision', 'Password123', device(1))
  blob.ignoreOnlyIfNew = true
  const first = await service.publishLearningBatch(a.token, payload(1, 11, 3))
  const altered = await service.publishLearningBatch(a.token, payload(1, 11, 4))
  assert.notEqual(first.sha256, altered.sha256)
  assert.equal([...blob.objects.keys()].filter(k => k.includes('/event-batches/v1/')).length, 2)
  assert.equal((await service.readLearningBatch(a.token, first)).batch.events[0].attemptId, uuid(3))
})
test('malformed attempts, duplicate IDs, local DB IDs and invalid selectors fail closed', async () => {
  const { service } = setup()
  const a = await service.register('event_invalid', 'Password123', device(1))
  const invalid = [payload(1, 1, 1), payload(1, 1, 1), payload(1, 1, 1)]
  invalid[0].events[0].id = 101
  invalid[1].events.push(row(1))
  invalid[2].deviceId = 'qwerty-web-Mozilla'
  for (const item of invalid) {
    await assert.rejects(service.publishLearningBatch(a.token, item),
      error => error.code === 'invalid_event_batch')
  }
  await assert.rejects(service.readLearningBatch(a.token, {
    deviceId: device(1), batchId: 'bad', sha256: '0'.repeat(64),
  }), error => error.code === 'invalid_event_selector')
})
test('account deletion removes batches; old token cannot access new user with same name', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_deleted', 'Password123', device(1))
  const receipt = await service.publishLearningBatch(a.token, payload(1, 1, 1))
  const deleted = await service.deleteAccount(a.token, 'Password123')
  assert.equal(deleted.deleted.eventBatchesDeleted, 1)
  assert.equal([...blob.objects.keys()].filter(k => k.includes('/event-batches/v1/')).length, 0)
  const replacement = await service.register('event_deleted', 'AnotherPassword', device(1))
  assert.notEqual(replacement.user.userId, a.user.userId)
  await assert.rejects(service.readLearningBatch(replacement.token, receipt),
    error => error.code === 'event_batch_not_visible')
  await assert.rejects(service.readLearningBatch(a.token, receipt),
    error => error.code === 'session_revoked')
})


test('observed catalog is not complete even when all visible receipts are listed', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_observed', 'Password123', device(1))
  const first = await service.publishLearningBatch(a.token, payload(1, 12, 4))
  const second = await service.publishLearningBatch(a.token, payload(1, 12, 5))
  const other = await service.publishLearningBatch(a.token, payload(2, 13, 6))
  const view = await service.observeLearningBatchReceipts(a.token)
  assert.equal(view.observedCount, 3)
  assert.equal(view.convergenceComplete, false)
  assert.equal(view.listingIsAuthoritative, false)
  assert.deepEqual(view.conflictingBatchIds, [device(1) + ':' + uuid(12)])
  assert.equal((await service.readLearningBatch(a.token, other)).batch.events.length, 1)
  const hidden = [...blob.objects.keys()].find(k => k.endsWith(second.sha256 + '.json'))
  assert.ok(hidden)
  blob.hiddenKeys = new Set([hidden])
  const stale = await service.observeLearningBatchReceipts(a.token)
  assert.equal(stale.observedCount, 2)
  assert.deepEqual(stale.conflictingBatchIds, [])
  assert.equal(stale.convergenceComplete, false)
  assert.equal((await service.readLearningBatch(a.token, second)).batch.events[0].attemptId,
    uuid(5))
  assert.equal((await service.readLearningBatch(a.token, first)).batch.events[0].attemptId,
    uuid(4))
})

test('tampered immutable batch is a server integrity failure, not a bad client request', async () => {
  const { service, blob } = setup()
  const a = await service.register('event_tampered', 'Password123', device(1))
  const receipt = await service.publishLearningBatch(a.token, payload(1, 20, 7))
  const key = [...blob.objects.keys()].find(k => k.endsWith(receipt.sha256 + '.json'))
  assert.ok(key)
  blob.objects.get(key).events[0].word = 'tampered'
  await assert.rejects(service.readLearningBatch(a.token, receipt),
    e => e.code === 'event_batch_integrity_failed')
})


test('M3.2 per-device immutable chain verifies predecessor and genesis deterministically', async () => {
  const { service, blob } = setup()
  const user = await service.register('chain_valid', 'Password123', device(1))
  const first = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 41, 1), sequence: 1, previous: null,
  })
  const second = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 42, 2), sequence: 2,
    previous: { batchId: first.batchId, sha256: first.sha256 },
  })
  const third = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 43, 3), sequence: 3,
    previous: { batchId: second.batchId, sha256: second.sha256 },
  })
  assert.equal(first.predecessorVerified, true)
  assert.equal(third.convergenceComplete, false)
  assert.equal([...blob.objects.keys()].filter(k => k.includes('event-batches/v2/')).length, 3)
  const history = await service.verifyChainedLearningHistory(user.token, third)
  assert.equal(history.verified, true)
  assert.equal(history.deviceChainOnly, true)
  assert.equal(history.convergenceComplete, false)
  assert.deepEqual(history.receipts.map(x => x.sequence), [1, 2, 3])
  assert.deepEqual(
    (await service.readChainedLearningBatch(user.token, second)).batch.previous,
    { batchId: first.batchId, sha256: first.sha256 },
  )
  assert.equal(
    (await service.publishChainedLearningBatch(user.token, {
      ...payload(1, 42, 2), sequence: 2,
      previous: { batchId: first.batchId, sha256: first.sha256 },
    })).sha256, second.sha256,
  )
  assert.equal([...blob.objects.keys()].filter(k => k.includes('event-batches/v2/')).length, 3)
})

test('M3.2 rejects a missing predecessor; retry succeeds after predecessor returns', async () => {
  const { service, blob } = setup()
  const user = await service.register('chain_retry', 'Password123', device(1))
  const first = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 51, 1), sequence: 1, previous: null,
  })
  const secondInput = { ...payload(1, 52, 2), sequence: 2,
    previous: { batchId: first.batchId, sha256: first.sha256 } }
  const key = [...blob.objects.keys()].find(k =>
    k.includes('event-batches/v2/') && k.includes(first.sha256))
  assert.ok(key)
  const held = blob.objects.get(key)
  blob.objects.delete(key)
  await assert.rejects(service.publishChainedLearningBatch(user.token, secondInput),
    error => error.code === 'event_chain_predecessor_not_visible')
  assert.equal([...blob.objects.keys()].filter(k => k.includes('event-batches/v2/')).length, 0)
  blob.objects.set(key, held)
  const second = await service.publishChainedLearningBatch(user.token, secondInput)
  assert.equal(second.sequence, 2)
})

test('M3.2 keeps both forks when same device concurrently appends from same parent', async () => {
  const { service, blob } = setup()
  const user = await service.register('chain_fork', 'Password123', device(1))
  const first = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 61, 1), sequence: 1, previous: null,
  })
  const parent = { batchId: first.batchId, sha256: first.sha256 }
  const [a, b] = await Promise.all([
    service.publishChainedLearningBatch(user.token, {
      ...payload(1, 62, 2), sequence: 2, previous: parent,
    }),
    service.publishChainedLearningBatch(user.token, {
      ...payload(1, 63, 3), sequence: 2, previous: parent,
    }),
  ])
  assert.notEqual(a.sha256, b.sha256)
  assert.equal([...blob.objects.keys()].filter(k => k.includes('event-batches/v2/')).length, 3)
  assert.equal((await service.verifyChainedLearningHistory(user.token, a)).verified, true)
  assert.equal((await service.verifyChainedLearningHistory(user.token, b)).verified, true)
  // Neither valid prefix proves it is the exclusive head or globally complete.
  assert.equal((await service.verifyChainedLearningHistory(user.token, b)).convergenceComplete,
    false)
})

test('M3.2 missing middle link and forged successor never validate as complete', async () => {
  const { service, blob } = setup()
  const user = await service.register('chain_gap', 'Password123', device(1))
  const one = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 71, 1), sequence: 1, previous: null,
  })
  const two = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 72, 2), sequence: 2,
    previous: { batchId: one.batchId, sha256: one.sha256 },
  })
  const three = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 73, 3), sequence: 3,
    previous: { batchId: two.batchId, sha256: two.sha256 },
  })
  const mid = [...blob.objects.keys()].find(k => k.includes(two.sha256))
  assert.ok(mid)
  blob.objects.delete(mid)
  const report = await service.verifyChainedLearningHistory(user.token, three)
  assert.equal(report.verified, false)
  assert.equal(report.reason, 'gap-or-stale-read')
  assert.equal(report.missing.sequence, 2)
  await assert.rejects(service.publishChainedLearningBatch(user.token, {
    ...payload(1, 74, 4), sequence: 4,
    previous: { batchId: uuid(79), sha256: '0'.repeat(64) },
  }), error => error.code === 'event_chain_predecessor_not_visible')
})

test('M3.2 invalid sequence, previous and tampered content fail closed', async () => {
  const { service, blob } = setup()
  const user = await service.register('chain_invalid', 'Password123', device(1))
  for (const input of [
    { ...payload(1, 81, 1), sequence: 2, previous: null },
    { ...payload(1, 81, 1), sequence: 1, previous: { batchId: uuid(9),
      sha256: '0'.repeat(64) } },
    { ...payload(1, 81, 1), sequence: 0, previous: null },
    { ...payload(1, 81, 1), sequence: 2,
      previous: { batchId: uuid(9), sha256: '0'.repeat(64), extra: 1 } },
  ]) {
    await assert.rejects(service.publishChainedLearningBatch(user.token, input),
      e => e.code === 'invalid_event_chain')
  }
  const first = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 82, 1), sequence: 1, previous: null,
  })
  const stored = [...blob.objects.keys()].find(k => k.includes('event-batches/v2/') &&
    k.includes(first.sha256))
  assert.ok(stored)
  blob.objects.get(stored).events[0].word = 'tampered'
  await assert.rejects(service.readChainedLearningBatch(user.token, first),
    e => e.code === 'event_chain_integrity_failed')
})

test('M3.2 account deletion removes linked batches and denies re-registered account', async () => {
  const { service, blob } = setup()
  const a = await service.register('chain_recycle', 'Password123', device(1))
  const head = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 90, 1), sequence: 1, previous: null,
  })
  const removed = await service.deleteAccount(a.token, 'Password123')
  assert.equal(removed.deleted.chainedEventBatchesDeleted, 1)
  const b = await service.register('chain_recycle', 'Password456', device(1))
  assert.notEqual(a.user.userId, b.user.userId)
  await assert.rejects(service.readChainedLearningBatch(b.token, head),
    e => e.code === 'event_chain_not_visible')
  assert.equal([...blob.objects.keys()].filter(k => k.includes('event-batches/v2/')).length, 0)
})
