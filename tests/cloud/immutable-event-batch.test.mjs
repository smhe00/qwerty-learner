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
const receipt = item => ({ deviceId: item.deviceId, sequence: item.sequence,
  batchId: item.batchId, sha256: item.sha256 })
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


test('M3.2 writer cannot claim another authenticated device ID', async () => {
  const { service } = setup()
  const owner = await service.register('chain_device_bound', 'Password123', device(1))
  const other = await service.login('chain_device_bound', 'Password123', device(2))
  await assert.rejects(service.publishChainedLearningBatch(other.token, {
    ...payload(1, 99, 9), sequence: 1, previous: null,
  }), error => error.code === 'event_device_mismatch')
  const first = await service.publishChainedLearningBatch(owner.token, {
    ...payload(1, 99, 9), sequence: 1, previous: null,
  })
  assert.equal((await service.readChainedLearningBatch(other.token, first)).batch.sequence, 1,
    'other authorized devices may read receipts but cannot write under another device')
})


test('M3.3 detects visible forked sequences and stale-observation gaps without proving completeness', async () => {
  const { service, blob } = setup()
  const a = await service.register('chain_observe', 'Password123', device(1))
  const first = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 101, 1), sequence: 1, previous: null,
  })
  const parent = { batchId: first.batchId, sha256: first.sha256 }
  const second = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 102, 2), sequence: 2, previous: parent,
  })
  const fork = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 103, 3), sequence: 2, previous: parent,
  })
  const third = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 104, 4), sequence: 3,
    previous: { batchId: second.batchId, sha256: second.sha256 },
  })
  const report = await service.observeChainedLearningReceipts(a.token)
  assert.equal(report.convergenceComplete, false)
  assert.equal(report.listingIsAuthoritative, false)
  assert.equal(report.observedCount, 4)
  assert.deepEqual(report.visibleForks, [device(1) + ':2'])
  assert.deepEqual(report.visibleGaps, [])
  assert.equal((await service.verifyChainedLearningHistory(a.token, third)).verified, true)
  assert.equal((await service.readChainedLearningBatch(a.token, fork)).batch.sequence, 2)

  // A second POP can temporarily omit one immutable object in a list result.
  const secondKey = [...blob.objects.keys()].find(k =>
    k.includes('event-batches/v2/') && k.includes(second.sha256))
  const forkKey = [...blob.objects.keys()].find(k =>
    k.includes('event-batches/v2/') && k.includes(fork.sha256))
  assert.ok(secondKey && forkKey)
  blob.hiddenKeys = new Set([secondKey, forkKey])
  const stale = await service.observeChainedLearningReceipts(a.token)
  assert.deepEqual(stale.visibleForks, [])
  assert.deepEqual(stale.visibleGaps, [device(1) + ':2'])
  assert.equal(stale.convergenceComplete, false)
  assert.equal((await service.readChainedLearningBatch(a.token, second)).batch.sequence, 2)
})


test('M3.4 repeated identical attempt UUID across linked batches is not double-counted', async () => {
  const { service } = setup()
  const user = await service.register('chain_duplicate', 'Password123', device(1))
  const one = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 111, 1), sequence: 1, previous: null,
  })
  const two = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 112, 1), sequence: 2,
    previous: { batchId: one.batchId, sha256: one.sha256 },
  })
  const result = await service.verifyChainedLearningHistory(user.token, two)
  assert.equal(result.verified, true)
  assert.equal(result.uniqueAttemptCount, 1)
  assert.equal(result.duplicateAttemptCount, 1)
  assert.equal(result.convergenceComplete, false)
})

test('M3.4 contradictory same UUID across linked batches blocks replay', async () => {
  const { service } = setup()
  const user = await service.register('chain_attempt_conflict', 'Password123', device(1))
  const one = await service.publishChainedLearningBatch(user.token, {
    ...payload(1, 121, 1), sequence: 1, previous: null,
  })
  const conflict = payload(1, 122, 1)
  conflict.events[0].wrongCount = 3
  const two = await service.publishChainedLearningBatch(user.token, {
    ...conflict, sequence: 2,
    previous: { batchId: one.batchId, sha256: one.sha256 },
  })
  await assert.rejects(service.verifyChainedLearningHistory(user.token, two),
    e => e.code === 'event_chain_attempt_conflict')
})

test('M3.5 two independent authenticated devices produce a stable witnessed digest', async () => {
  const { service, blob } = setup()
  const a = await service.register('witness_multi', 'Password123', device(1))
  const b = await service.login('witness_multi', 'Password123', device(2))
  const first = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 141, 1), sequence: 1, previous: null,
  })
  const second = await service.publishChainedLearningBatch(b.token, {
    ...payload(2, 142, 2), sequence: 1, previous: null,
  })
  const one = await service.verifyWitnessedChainSet(a.token,
    { heads: [receipt(first), receipt(second)] })
  const reversed = await service.verifyWitnessedChainSet(b.token,
    { heads: [receipt(second), receipt(first), receipt(first)] })
  assert.equal(one.verified, true)
  assert.equal(one.uniqueAttemptCount, 2)
  assert.equal(one.deviceCount, 2)
  assert.equal(one.publishReady, false)
  assert.equal(one.convergenceComplete, false)
  assert.equal(one.listingIsAuthoritative, false)
  assert.equal(one.evidenceSha256, reversed.evidenceSha256)
  assert.equal(reversed.headCount, 2, 'exact repeated head is idempotent')
  // An eventually consistent listing can completely hide one device.
  const otherKey = [...blob.objects.keys()].find(k =>
    k.includes('event-batches/v2/') && k.includes(second.sha256))
  blob.hiddenKeys = new Set([otherKey])
  const observed = await service.observeChainedLearningReceipts(a.token)
  assert.equal(observed.observedCount, 1)
  assert.equal((await service.verifyWitnessedChainSet(a.token,
    { heads: [receipt(first), receipt(second)] })).verified, true)
  assert.equal(observed.convergenceComplete, false)
})

test('M3.5 blocks conflicting UUID evidence across different device chains', async () => {
  const { service } = setup()
  const a = await service.register('witness_contradict', 'Password123', device(1))
  const b = await service.login('witness_contradict', 'Password123', device(2))
  const first = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 151, 1), sequence: 1, previous: null,
  })
  const altered = payload(2, 152, 1)
  altered.events[0].wrongCount = 2
  const second = await service.publishChainedLearningBatch(b.token, {
    ...altered, sequence: 1, previous: null,
  })
  await assert.rejects(service.verifyWitnessedChainSet(b.token,
    { heads: [receipt(first), receipt(second)] }), e => e.code === 'event_chain_attempt_conflict')
})

test('M3.5 rejects a fork even if both witnessed device histories reach genesis', async () => {
  const { service } = setup()
  const a = await service.register('witness_fork', 'Password123', device(1))
  const one = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 161, 1), sequence: 1, previous: null,
  })
  const preceding = { batchId: one.batchId, sha256: one.sha256 }
  const left = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 162, 2), sequence: 2, previous: preceding,
  })
  const right = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 163, 3), sequence: 2, previous: preceding,
  })
  await assert.rejects(service.verifyWitnessedChainSet(a.token,
    { heads: [receipt(left), receipt(right)] }), e => e.code === 'event_chain_fork_conflict')
})

test('M3.5 missing or tampered witness fails closed and never publishes', async () => {
  const { service, blob } = setup()
  const a = await service.register('witness_missing', 'Password123', device(1))
  const one = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 171, 1), sequence: 1, previous: null,
  })
  const two = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 172, 2), sequence: 2,
    previous: { batchId: one.batchId, sha256: one.sha256 },
  })
  for (const heads of [[], [receipt(one), receipt(two), receipt(one), receipt(two), receipt(one)],
    [{ ...receipt(one), sequence: 129 }], [{ ...receipt(one), invalid: 1 }]]) {
    await assert.rejects(service.verifyWitnessedChainSet(a.token,
      { heads }), e => e.code === 'invalid_event_head_set')
  }
  const key = [...blob.objects.keys()].find(k =>
    k.includes('event-batches/v2/') && k.includes(one.sha256))
  const saved = blob.objects.get(key)
  blob.objects.delete(key)
  const missing = await service.verifyWitnessedChainSet(a.token, { heads: [receipt(two)] })
  assert.equal(missing.verified, false)
  assert.equal(missing.reason, 'gap-or-stale-read')
  assert.equal(missing.convergenceComplete, false)
  blob.objects.set(key, saved)
  blob.objects.get(key).events[0].word = 'tampered'
  await assert.rejects(service.verifyWitnessedChainSet(a.token, { heads: [receipt(two)] }),
    e => e.code === 'event_chain_integrity_failed')
})

test('M3.5 cannot accept witnessed event receipts from another account', async () => {
  const { service } = setup()
  const a = await service.register('witness_a', 'Password123', device(1))
  const b = await service.register('witness_b', 'Password123', device(2))
  const record = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 181, 1), sequence: 1, previous: null,
  })
  const result = await service.verifyWitnessedChainSet(b.token, { heads: [receipt(record)] })
  assert.equal(result.verified, false)
  assert.equal(result.reason, 'gap-or-stale-read')
})

test('M2.10 server checkout receipt uses authenticated device, exact V4 meta and chained head', async () => {
  const { storage, service, blob } = setup()
  const first = await service.register('checkout_service_a', 'Password123', device(1))
  const second = await service.login('checkout_service_a', 'Password123', device(2))
  const owner = first.user.userId
  const cloudFingerprint = 'd'.repeat(64)
  await storage.createRevision(owner, 1, {
    schemaVersion: 1, revision: 1, updatedAt: '2026-10-22T00:00:00Z',
    sizeBytes: 12, dataSha256: 'e'.repeat(64),
    logicalFingerprint: cloudFingerprint,
    payloadEncoding: 'base64', payloadBase64: 'H4sI',
    deviceId: device(1), clientFormatVersion: 'qwerty-backup-v4',
  })
  const chain = await service.publishChainedLearningBatch(first.token, {
    ...payload(1, 801, 11), sequence: 1, previous: null,
  })
  const confirmed = await service.issueChainedCheckout(first.token, {
    cloudRevision: 1, cloudFingerprint, eventHead: receipt(chain),
  })
  assert.equal(confirmed.verifiedExactReceipt, true)
  assert.equal(confirmed.convergenceComplete, false)
  const verified = await service.readChainedCheckout(second.token, confirmed.receipt)
  assert.equal(verified.deviceId, device(1))
  assert.equal(verified.cloudRevision, 1)
  assert.equal(verified.cloudFingerprint, cloudFingerprint)
  assert.equal(verified.scope, 'device-declared-checkout-only')
  assert.equal(verified.publishReady, false)
  const keys = [...blob.objects.keys()].filter(key => key.includes('/device-checkouts/v1/'))
  assert.equal(keys.length, 1)
  assert.equal(keys[0].includes(device(1)), true)
  await assert.rejects(service.issueChainedCheckout(second.token, {
    cloudRevision: 1, cloudFingerprint, eventHead: receipt(chain),
  }), /checkout-request-invalid/)
  await assert.rejects(service.issueChainedCheckout(first.token, {
    cloudRevision: 1, cloudFingerprint: 'f'.repeat(64),
    eventHead: receipt(chain),
  }), /checkout-cloud-revision-not-verified/)
  await assert.rejects(service.issueChainedCheckout(first.token, {
    cloudRevision: 1, cloudFingerprint,
    eventHead: { ...receipt(chain), sha256: '0'.repeat(64) },
  }), /checkout-event-head-not-verified/)
  assert.equal(keys.length, 1)
})

test('M2.10 checkout read refuses foreign-account access or modified Blob contents', async () => {
  const { storage, service, blob } = setup()
  const a = await service.register('checkout_replay_a', 'Password123', device(1))
  const b = await service.register('checkout_replay_b', 'Password123', device(2))
  const cloudFingerprint = 'a'.repeat(64)
  await storage.createRevision(a.user.userId, 1, {
    schemaVersion: 1, revision: 1, updatedAt: '2026-10-22T00:00:00Z',
    sizeBytes: 12, dataSha256: 'e'.repeat(64),
    logicalFingerprint: cloudFingerprint,
    payloadEncoding: 'base64', payloadBase64: 'H4sI',
    deviceId: device(1), clientFormatVersion: 'qwerty-backup-v4',
  })
  const head = await service.publishChainedLearningBatch(a.token, {
    ...payload(1, 802, 12), sequence: 1, previous: null,
  })
  const { receipt: selector } = await service.issueChainedCheckout(a.token, {
    cloudRevision: 1, cloudFingerprint, eventHead: receipt(head),
  })
  assert.equal(await service.readChainedCheckout(b.token, selector), null)
  const key = [...blob.objects.keys()].find(name => name.includes('/device-checkouts/v1/'))
  assert.ok(key)
  blob.objects.get(key).cloudRevision = 2
  await assert.rejects(service.readChainedCheckout(a.token, selector),
    /checkout-receipt-content-sha-mismatch/)
})

test('M2.10 checkout interface remains unavailable when M3 event pilot is off', async () => {
  const store = createEdgeOneBlobStorage(new FakeBlob())
  const service = createBackendService({ storage: store, multiSessionEnabled: true })
  const a = await service.register('checkout_off', 'Password123', device(1))
  await assert.rejects(service.issueChainedCheckout(a.token, {}),
    e => e.code === 'not_found')
  await assert.rejects(service.readChainedCheckout(a.token, {}),
    e => e.code === 'not_found')
})
