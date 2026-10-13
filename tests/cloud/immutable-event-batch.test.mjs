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
    .filter(key => key.startsWith(prefix)).map(key => ({ key })) } }
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
