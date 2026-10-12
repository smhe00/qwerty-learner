/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCircleBlobStorage } from '../../cloud-functions/_shared/circle/blob-storage.js'
import { createCircleService } from '../../cloud-functions/_shared/circle/service.js'

const clone = (x) => x === null ? null : JSON.parse(JSON.stringify(x))
class FakeBlob {
  objects = new Map()
  ambiguous = false
  failedReads = 0
  async get(key, options) {
    assert.equal(options.type, 'json')
    assert.equal(options.consistency, 'strong')
    if (this.failedReads > 0) { this.failedReads -= 1; throw Error('transient read') }
    return this.objects.has(key) ? clone(this.objects.get(key)) : null
  }
  async setJSON(key, value, options) {
    assert.equal(options.onlyIfNew, true)
    if (this.objects.has(key)) throw Error('key already exists')
    this.objects.set(key, clone(value))
    if (this.ambiguous) {
      this.ambiguous = false
      throw Error('response lost after durable write')
    }
  }
}
function setup() {
  const blob = new FakeBlob()
  const storage = createCircleBlobStorage(blob)
  const service = createCircleService({
    storage,
    authenticate: async (token) => {
      if (token === 'bad') throw Error('invalid token')
      return { user: { userId: token } }
    },
    verifyAchievement: async (_userId, id) => id === 'ACH_MASTERED_100',
  })
  return { blob, storage, service }
}
const owner = 'owner_0000000001'
const alice = 'alice_0000000001'
const bob = 'bob_00000000001'
const eve = 'eve_00000000001'
const today = () => new Date().toISOString().slice(0, 10)
const event = (id, newWords = 32) => ({ completed: true, newWords, eventId: id })

test('Circle Blob storage isolates social/v1 and recovers ambiguous create-only commit', async () => {
  const { blob, storage } = setup()
  blob.ambiguous = true
  assert.equal(await storage.create('circles/test/meta.json', { z: 1 }), true)
  assert.equal(await storage.create('circles/test/meta.json', { z: 1 }), true)
  assert.equal(await storage.create('circles/test/meta.json', { z: 2 }), false)
  assert.deepEqual(await storage.read('circles/test/meta.json'), { z: 1 })
  assert.deepEqual([...blob.objects.keys()], ['social/v1/circles/test/meta.json'])
})

test('Invite is secret-bearing, no member access without authentication', async () => {
  const { blob, service } = setup()
  const circle = await service.createCircle(owner, { name: '初二英语搭子' })
  assert.match(circle.inviteCode, /^QC-[A-Za-z0-9_-]{12}-[A-Za-z0-9_-]{12}$/)
  assert.equal(JSON.stringify([...blob.objects.values()]).includes(circle.inviteCode), false)
  assert.equal((await service.getCircle(owner, circle.circleId)).members.length, 1)
  await assert.rejects(service.getCircle(alice, circle.circleId), { code: 'not_circle_member' })
  await assert.rejects(service.joinCircle(alice, circle.inviteCode.slice(0, -1) + '!'), {
    code: 'invalid_invite',
  })
  const joined = await service.joinCircle(alice, circle.inviteCode)
  assert.equal(joined.role, 'member')
  await assert.rejects(service.getCircle('bad', circle.circleId))
})

test('Concurrent joins never oversubscribe 12-person lifetime capacity', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  const users = Array.from({ length: 30 }, (_x, i) => `student_${String(i).padStart(5, '0')}`)
  const results = await Promise.allSettled(users.map((uid) =>
    service.joinCircle(uid, circle.inviteCode)))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 11)
  assert.equal(results.filter((r) => r.status === 'rejected').length, 19)
  const snapshot = await service.getCircle(owner, circle.circleId)
  assert.equal(snapshot.members.length, 12)
  assert.equal(new Set(snapshot.members.map((m) => m.userId)).size, 12)
  assert.equal(snapshot.maxMembers, 12)
})

test('Concurrent retries of one user occupy one seat', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  const results = await Promise.allSettled(Array.from({ length: 16 }, () =>
    service.joinCircle(alice, circle.inviteCode)))
  assert.ok(results.some((result) => result.status === 'fulfilled'))
  // A competing request must not allocate another seat just because its first
  // read raced the initial leader. A 409 pending response is retriable.
  assert.ok(results.every((result) => result.status === 'fulfilled' ||
    result.reason?.code === 'join_in_progress'))
  await service.joinCircle(alice, circle.inviteCode)
  assert.equal((await service.getCircle(owner, circle.circleId)).members.length, 2)
})

test('Member cannot remove others, owner cannot exit, revoked members cannot rejoin/read', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  await service.joinCircle(bob, circle.inviteCode)
  await assert.rejects(service.removeMember(alice, circle.circleId, bob), {
    code: 'not_circle_owner',
  })
  await assert.rejects(service.leaveCircle(owner, circle.circleId), {
    code: 'owner_cannot_leave',
  })
  assert.deepEqual(await service.removeMember(owner, circle.circleId, alice), { revoked: true })
  await assert.rejects(service.getCircle(alice, circle.circleId), { code: 'not_circle_member' })
  await assert.rejects(service.joinCircle(alice, circle.inviteCode), { code: 'membership_revoked' })
  assert.deepEqual((await service.getCircle(bob, circle.circleId)).members.map((m) => m.userId),
    [owner, bob])
})

test('Leaving is permanent in V1 and membership remains bounded', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  assert.deepEqual(await service.leaveCircle(alice, circle.circleId), { revoked: true })
  assert.deepEqual(await service.leaveCircle(alice, circle.circleId), { revoked: true })
  await assert.rejects(service.joinCircle(alice, circle.inviteCode), { code: 'membership_revoked' })
})

test('Daily progress is own-account authored, bounded, and idempotent', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  const day = today()
  const report = await service.publishProgress(alice, circle.circleId, day,
    event('event_0001'))
  const retry = await service.publishProgress(alice, circle.circleId, day,
    event('event_0001'))
  assert.deepEqual(report, retry)
  assert.equal(report.authorUserId, alice)
  assert.equal(report.selfReported, true)
  await assert.rejects(
    service.publishProgress(alice, circle.circleId, day, event('event_0001', 12)),
    { code: 'idempotency_conflict' },
  )
  for (const i of [2, 3, 4]) {
    await service.publishProgress(alice, circle.circleId, day,
      event('event_000' + i, i))
  }
  await assert.rejects(service.publishProgress(alice, circle.circleId, day,
    event('event_0005')), { code: 'daily_progress_limit' })
  assert.equal((await service.getProgress(owner, circle.circleId, day))[0].newWords, 4)
  await assert.rejects(service.publishProgress(eve, circle.circleId, day,
    event('event_9999')), { code: 'not_circle_member' })
})

test('Concurrent per-day reports stay within four immutable slots', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  const jobs = Array.from({ length: 20 }, (_x, i) => service.publishProgress(
    owner, circle.circleId, today(), event(`evt_${String(i).padStart(8, '0')}`, i)))
  const results = await Promise.allSettled(jobs)
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 4)
  assert.equal(results.filter((r) => r.status === 'rejected').length, 16)
})

test('Reaction is one immutable clap per actor and requires visible progress', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  await service.joinCircle(bob, circle.inviteCode)
  await assert.rejects(service.reactProgress(alice, circle.circleId, owner, today()), {
    code: 'progress_not_found',
  })
  await service.publishProgress(owner, circle.circleId, today(), event('event_0001'))
  await Promise.all(Array.from({ length: 8 }, () =>
    service.reactProgress(alice, circle.circleId, owner, today())))
  await service.reactProgress(bob, circle.circleId, owner, today())
  assert.equal((await service.getReactions(owner, circle.circleId, owner, today())).count, 2)
  await assert.rejects(service.reactProgress(eve, circle.circleId, owner, today()), {
    code: 'not_circle_member',
  })
})

test('Revocation removes visibility of self-reported progress and denies reader', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  await service.publishProgress(alice, circle.circleId, today(), event('event_0001'))
  assert.equal((await service.getProgress(owner, circle.circleId, today())).length, 1)
  await service.removeMember(owner, circle.circleId, alice)
  assert.equal((await service.getProgress(owner, circle.circleId, today())).length, 0)
  await assert.rejects(service.getProgress(alice, circle.circleId, today()), {
    code: 'not_circle_member',
  })
})

test('Showcase requires external authoritative verification; closure blocks access', async () => {
  const { service, storage } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await service.joinCircle(alice, circle.inviteCode)
  await assert.rejects(service.shareAchievement(alice, circle.circleId,
    'ACH_UNVERIFIED'), { code: 'unverified_achievement' })
  await service.shareAchievement(alice, circle.circleId, 'ACH_MASTERED_100')
  assert.equal((await service.getShowcase(owner, circle.circleId, alice,
    ['ACH_MASTERED_100'])).length, 1)
  await service.closeCircle(owner, circle.circleId)
  await assert.rejects(service.getCircle(alice, circle.circleId), { code: 'circle_closed' })
  await assert.rejects(service.getShowcase(owner, circle.circleId, alice,
    ['ACH_MASTERED_100']), { code: 'circle_closed' })
  assert.ok((await storage.read('circles/' + circle.circleId + '/closed.json')))
})

test('No arbitrary ID/path injection and invalid progress is blocked', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Circle' })
  await assert.rejects(service.getCircle(owner, '../accounts'), { code: 'invalid_circle' })
  await assert.rejects(service.publishProgress(owner, circle.circleId, '2026-02-30',
    event('event_0001')), { code: 'invalid_day' })
  await assert.rejects(service.publishProgress(owner, circle.circleId, today(),
    { completed: true, newWords: 1e9, eventId: 'event_0001' }), {
    code: 'invalid_progress',
  })
})

test('An admission leader stuck between claim and seat does not duplicate seats', async () => {
  const { blob, service } = setup()
  const circle = await service.createCircle(owner, { name: 'Race' })
  const originalSetJSON = blob.setJSON.bind(blob)
  let unblock
  const locked = new Promise((resolve) => { unblock = resolve })
  let entered
  const arrived = new Promise((resolve) => { entered = resolve })
  let intercepted = false
  blob.setJSON = async (key, value, options) => {
    if (!intercepted && key.includes('/seats/')) {
      intercepted = true
      entered()
      await locked
    }
    return originalSetJSON(key, value, options)
  }
  const first = service.joinCircle(alice, circle.inviteCode)
  await arrived
  await assert.rejects(service.joinCircle(alice, circle.inviteCode),
    { code: 'join_in_progress' })
  unblock()
  await first
  await service.joinCircle(alice, circle.inviteCode)
  const snapshot = await service.getCircle(owner, circle.circleId)
  assert.deepEqual(snapshot.members.map((m) => m.userId), [owner, alice])
})

test('Concurrent same-event publications cannot consume multiple daily slots', async () => {
  const { blob, service } = setup()
  const circle = await service.createCircle(owner, { name: 'Race' })
  const originalSetJSON = blob.setJSON.bind(blob)
  let unblock
  const gate = new Promise((resolve) => { unblock = resolve })
  let arrived
  const entering = new Promise((resolve) => { arrived = resolve })
  let intercepted = false
  blob.setJSON = async (key, value, options) => {
    if (!intercepted && key.includes('/progress/') && key.endsWith('/00.json')) {
      intercepted = true
      arrived()
      await gate
    }
    return originalSetJSON(key, value, options)
  }
  const first = service.publishProgress(owner, circle.circleId, today(),
    event('same_event_1234', 10))
  await entering
  await assert.rejects(service.publishProgress(owner, circle.circleId, today(),
    event('same_event_1234', 10)), { code: 'progress_in_progress' })
  unblock()
  await first
  const retry = await service.publishProgress(owner, circle.circleId, today(),
    event('same_event_1234', 10))
  assert.equal(retry.newWords, 10)
  const progress = [...blob.objects.keys()].filter((key) => key.includes('/progress/') &&
    key.endsWith('.json'))
  assert.equal(progress.length, 1)
})
