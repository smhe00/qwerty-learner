/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCircleBlobStorage } from '../../cloud-functions/_shared/circle/blob-storage.js'
import { createCircleService } from '../../cloud-functions/_shared/circle/service.js'
import { createCircleHttpHandler } from '../../cloud-functions/_shared/circle/http.js'

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
  async list({ prefix, consistency }) {
    assert.equal(consistency, 'strong')
    return { blobs: [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key })) }
  }
  failedDeletes = 0
  async delete(key) {
    if (this.failedDeletes > 0) {
      this.failedDeletes--
      throw new Error('transient delete failure')
    }
    this.objects.delete(key)
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
  const results = await Promise.all(Array.from({ length: 16 }, () =>
    service.joinCircle(alice, circle.inviteCode)))
  assert.equal(results.length, 16)
  assert.ok(results.every((result) => result.role === 'member'))
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

test('A stalled admission can be safely helped by a concurrent retry', async () => {
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
  const second = await service.joinCircle(alice, circle.inviteCode)
  assert.equal(second.role, 'member')
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
  const second = await service.publishProgress(owner, circle.circleId, today(),
    event('same_event_1234', 10))
  assert.equal(second.newWords, 10)
  unblock()
  await first
  const retry = await service.publishProgress(owner, circle.circleId, today(),
    event('same_event_1234', 10))
  assert.equal(retry.newWords, 10)
  const progress = [...blob.objects.keys()].filter((key) => key.includes('/progress/') &&
    key.endsWith('.json'))
  assert.equal(progress.length, 1)
})

test('Account quarantine fences access and indexes every durable membership', async () => {
  const { storage, service } = setup()
  const first = await service.createCircle(owner, { name: 'First' })
  const second = await service.createCircle(alice, { name: 'Second' })
  await service.joinCircle(alice, first.inviteCode)
  await service.joinCircle(bob, second.inviteCode)
  await service.publishProgress(alice, first.circleId, today(),
    event('quarantine_0001', 8))
  assert.equal((await service.getProgress(owner, first.circleId, today())).length, 1)
  assert.deepEqual(await service.quarantineAccount(alice),
    { disabled: true, circleCount: 2 })
  assert.deepEqual(await service.quarantineAccount(alice),
    { disabled: true, circleCount: 2 })
  assert.equal((await service.getProgress(owner, first.circleId, today())).length, 0)
  assert.deepEqual((await service.getCircle(owner, first.circleId)).members.map((m) => m.userId),
    [owner])
  await assert.rejects(service.getCircle(alice, first.circleId),
    { code: 'circle_account_disabled' })
  await assert.rejects(service.publishProgress(alice, first.circleId, today(),
    event('quarantine_0002', 20)), { code: 'circle_account_disabled' })
  await assert.rejects(service.getCircle(bob, second.circleId),
    { code: 'circle_closed' })
  assert.equal((await storage.list('user-circles/alice_0000000001/')).length, 2)
})

test('Circle listing always scopes returned keys to social namespace', async () => {
  const { blob, storage } = setup()
  await storage.create('user-circles/aa/one.json', { ok: true })
  blob.objects.set('users/private-account/revisions/1.json', { leaked: true })
  assert.deepEqual(await storage.list('user-circles/aa/'),
    ['user-circles/aa/one.json'])
  assert.equal((await storage.list('user-circles/')).length, 1)
})

test('HTTP routes are disabled by default and cannot weaken rate limiting', async () => {
  const { service } = setup()
  const disabled = createCircleHttpHandler({ service })
  const request = new Request('https://qwerty.example/api/circle/v1', {
    method: 'POST', headers: { Authorization: 'Bearer ' + owner,
      'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hi' }),
  })
  await assert.rejects(disabled.handle(request), { code: 'not_found' })
  assert.throws(() => createCircleHttpHandler({ service, enabled: true }),
    /rate limiter/)
})

test('HTTP contract authenticates before parsing, bounds JSON, never accepts actor ID', async () => {
  const { service } = setup()
  let limiterCalls = 0
  const api = createCircleHttpHandler({
    service, enabled: true, rateLimit: async () => { limiterCalls++; return true },
  })
  const req = (path, method = 'GET', body, token = owner, type = 'application/json') =>
    new Request('https://qwerty.example/api/circle/v1' + path, {
      method,
      headers: { Authorization: token ? 'Bearer ' + token : '',
        'Content-Type': type },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  await assert.rejects(api.handle(req('/', 'POST', { name: 'Hi' }, null)),
    { code: 'missing_token' })
  await assert.rejects(api.handle(req('/', 'POST', { name: 'Hi' }, owner, 'text/plain')),
    { code: 'unsupported_media_type' })
  await assert.rejects(api.handle(req('/', 'POST', { name: 'x'.repeat(9000) })),
    { code: 'circle_request_too_large' })
  const created = await api.handle(req('/', 'POST', { name: 'My Circle', userId: eve }))
  assert.equal(created.status, 201)
  assert.equal(created.headers.get('cache-control'), 'no-store')
  assert.equal(created.headers.get('access-control-allow-origin'), null)
  const first = await created.json()
  assert.equal(first.ok, true)
  const id = first.circleId
  assert.equal((await (await api.handle(req('/' + id))).json()).ownerUserId, owner)
  await assert.rejects(api.handle(req('/' + id, 'GET', undefined, eve)),
    { code: 'not_circle_member' })
  const joined = await api.handle(req('/join', 'POST', {
    inviteCode: first.inviteCode, userId: eve,
  }, alice))
  assert.equal(joined.status, 200)
  assert.equal((await (await api.handle(req('/' + id))).json()).members.length, 2)
  const published = await api.handle(req('/' + id + '/progress/' + today(), 'POST',
    { completed: true, newWords: 32, eventId: 'published_1234', userId: eve }, alice))
  assert.equal(published.status, 201)
  const visible = await (await api.handle(req('/' + id + '/progress/' + today()))).json()
  assert.equal(visible.progress[0].authorUserId, alice)
  assert.equal(limiterCalls > 4, true)
})

test('HTTP limiter denies all Circle traffic when blocked', async () => {
  const { service } = setup()
  const api = createCircleHttpHandler({ service, enabled: true, rateLimit: async () => false })
  const request = new Request('https://qwerty.example/api/circle/v1', {
    method: 'POST', headers: {
      'Authorization': 'Bearer ' + owner,
      'Content-Type': 'application/json',
    }, body: JSON.stringify({ name: 'My Circle' }),
  })
  await assert.rejects(api.handle(request), { code: 'circle_rate_limited' })
})

test('Rotating invite keeps existing members and rejects stale codes', async () => {
  const { service } = setup()
  const first = await service.createCircle(owner, { name: 'Rotations' })
  await service.joinCircle(alice, first.inviteCode)
  await assert.rejects(service.rotateInvite(alice, first.circleId),
    { code: 'not_circle_owner' })
  const rotated = await service.rotateInvite(owner, first.circleId)
  assert.equal(rotated.revision, 1)
  assert.notEqual(rotated.inviteCode, first.inviteCode)
  await assert.rejects(service.joinCircle(bob, first.inviteCode),
    { code: 'invalid_invite' })
  await service.joinCircle(bob, rotated.inviteCode)
  assert.deepEqual((await service.getCircle(owner, first.circleId)).members
    .map((m) => m.userId), [owner, alice, bob])
})

test('Two concurrent invite rotations cannot disclose two live codes', async () => {
  const { service } = setup()
  const circle = await service.createCircle(owner, { name: 'Rotations' })
  const outcomes = await Promise.allSettled([
    service.rotateInvite(owner, circle.circleId),
    service.rotateInvite(owner, circle.circleId),
  ])
  // Either one winner and one conflict or, if both start serially, two
  // successive CAS revisions; latest alone is valid in either case.
  const succeeded = outcomes.filter((o) => o.status === 'fulfilled').map((o) => o.value)
  assert.ok(succeeded.length >= 1)
  assert.ok(succeeded.length <= 2)
  if (succeeded.length === 2) {
    assert.notEqual(succeeded[0].revision, succeeded[1].revision)
  }
  const last = succeeded.reduce((a, b) => a.revision > b.revision ? a : b)
  await service.joinCircle(alice, last.inviteCode)
  await assert.rejects(service.joinCircle(bob, circle.inviteCode),
    { code: 'invalid_invite' })
})

test('Abandoned pre-write admission can be retried without seat leakage', async () => {
  const { blob, service } = setup()
  const circle = await service.createCircle(owner, { name: 'Recover' })
  const original = blob.setJSON.bind(blob)
  let failSeat = true
  blob.setJSON = async (key, value, options) => {
    if (failSeat && key.includes('/seats/')) {
      throw new Error('simulated crash before durable seat')
    }
    return original(key, value, options)
  }
  await assert.rejects(service.joinCircle(alice, circle.inviteCode),
    /simulated crash/)
  assert.equal((await service.getCircle(owner, circle.circleId)).members.length, 1)
  failSeat = false
  await service.joinCircle(alice, circle.inviteCode)
  assert.equal((await service.getCircle(owner, circle.circleId)).members.length, 2)
  assert.equal([...blob.objects.keys()].filter((k) => k.includes('/join-claims/')).length, 0)
})

test('Abandoned progress write retries the same event and respects idempotency', async () => {
  const { blob, service } = setup()
  const circle = await service.createCircle(owner, { name: 'Recover' })
  const original = blob.setJSON.bind(blob)
  let failProgress = true
  blob.setJSON = async (key, value, options) => {
    if (failProgress && key.includes('/progress/')) {
      throw new Error('simulated crash before durable report')
    }
    return original(key, value, options)
  }
  await assert.rejects(service.publishProgress(owner, circle.circleId, today(),
    event('recover_event_11', 15)), /simulated crash/)
  failProgress = false
  const report = await service.publishProgress(owner, circle.circleId, today(),
    event('recover_event_11', 15))
  const retry = await service.publishProgress(owner, circle.circleId, today(),
    event('recover_event_11', 15))
  assert.deepEqual(report, retry)
  assert.equal([...blob.objects.keys()].filter((k) => k.includes('/progress-claims/')).length, 0)
})

test('Retired member activity scrub removes progress, showcase and both clap directions', async () => {
  const { blob, service, storage } = setup()
  const group = await service.createCircle(owner, { name: 'Erase' })
  await service.joinCircle(alice, group.inviteCode)
  await service.joinCircle(bob, group.inviteCode)
  await service.publishProgress(alice, group.circleId, today(), event('scrub_event_001', 15))
  await service.publishProgress(bob, group.circleId, today(), event('scrub_event_002', 9))
  await service.reactProgress(bob, group.circleId, alice, today())
  await service.reactProgress(alice, group.circleId, bob, today())
  await service.shareAchievement(alice, group.circleId, 'ACH_MASTERED_100')
  await service.shareAchievement(bob, group.circleId, 'ACH_MASTERED_100')
  const result = await service.scrubAccountActivities(alice)
  assert.equal(result.quarantined, true)
  assert.equal(result.fullyErased, false)
  assert.equal(result.followUpRequired, true)
  assert.equal(result.circlesAffected, 1)
  assert.equal(result.deleted, 4)
  assert.deepEqual((await service.getProgress(owner, group.circleId, today()))
    .map((p) => p.authorUserId), [bob])
  assert.equal((await service.getReactions(owner, group.circleId, bob, today())).count, 0)
  assert.ok(await storage.read('circles/' + group.circleId + '/showcase/' +
    bob + '/ACH_MASTERED_100.json'))
  const keyList = [...blob.objects.keys()]
  assert.equal(keyList.some((k) => k.includes('/progress/' + alice + '/')), false)
  assert.equal(keyList.some((k) => k.includes('/showcase/' + alice + '/')), false)
  assert.equal(keyList.some((k) => k.includes('/reactions/' + alice + '/')), false)
  assert.equal(keyList.some((k) => k.includes('/reactions/' + bob + '/' + alice + '/')), false)
  const again = await service.scrubAccountActivities(alice)
  assert.equal(again.deleted, 0)
})

test('Account scrub retries failed deletion and remains safely quarantined', async () => {
  const { blob, service } = setup()
  const group = await service.createCircle(owner, { name: 'Erase' })
  await service.joinCircle(alice, group.inviteCode)
  await service.publishProgress(alice, group.circleId, today(), event('scrub_retry_11', 8))
  blob.failedDeletes = 20
  await assert.rejects(service.scrubAccountActivities(alice), /delete failure/)
  await assert.rejects(service.getCircle(alice, group.circleId),
    { code: 'circle_account_disabled' })
  assert.equal((await service.getProgress(owner, group.circleId, today())).length, 0)
  blob.failedDeletes = 0
  const after = await service.scrubAccountActivities(alice)
  assert.equal(after.deleted, 1)
  assert.equal(after.quarantined, true)
})

test('Scrubbing the owner seals the circle before removing owned activity', async () => {
  const { service, storage } = setup()
  const group = await service.createCircle(owner, { name: 'Erase' })
  await service.joinCircle(alice, group.inviteCode)
  await service.publishProgress(owner, group.circleId, today(), event('owner_scrub_111'))
  const result = await service.scrubAccountActivities(owner)
  assert.equal(result.deleted, 1)
  assert.ok(await storage.read('circles/' + group.circleId + '/closed.json'))
  await assert.rejects(service.getCircle(alice, group.circleId), { code: 'circle_closed' })
})

test('An in-flight write after quarantine needs an additional scrub pass', async () => {
  const { blob, storage, service } = setup()
  const group = await service.createCircle(owner, { name: 'Race erase' })
  await service.joinCircle(alice, group.inviteCode)
  const original = blob.setJSON.bind(blob)
  let resume
  const waiting = new Promise((resolve) => { resume = resolve })
  let release
  const arrived = new Promise((resolve) => { release = resolve })
  let blocked = false
  blob.setJSON = async (key, value, options) => {
    if (!blocked && key.includes('/progress/' + alice + '/')) {
      blocked = true
      release()
      await waiting
    }
    return original(key, value, options)
  }
  const pending = service.publishProgress(alice, group.circleId, today(),
    event('after_fence_001', 8))
  await arrived
  const first = await service.scrubAccountActivities(alice)
  assert.equal(first.deleted, 0)
  assert.equal(first.fullyErased, false)
  resume()
  await assert.rejects(pending, { code: 'circle_account_disabled' })
  // The durable fence prevents API visibility, but an old in-flight writer
  // can still leave a private residual record after a successful scrub pass.
  assert.equal((await service.getProgress(owner, group.circleId, today())).length, 0)
  assert.equal((await storage.list('circles/' + group.circleId +
    '/progress/' + alice + '/')).length, 1)
  const second = await service.scrubAccountActivities(alice)
  assert.equal(second.deleted, 1)
  assert.equal((await storage.list('circles/' + group.circleId +
    '/progress/' + alice + '/')).length, 0)
})

test('Adversarial interleaved joins keep every user in at most one seat', async () => {
  for (let round = 0; round < 12; round++) {
    const { blob, service } = setup()
    const group = await service.createCircle(owner, { name: 'Stress' })
    const write = blob.setJSON.bind(blob)
    let sequence = round
    blob.setJSON = async (key, value, options) => {
      if (key.includes('/seats/')) {
        sequence = ((sequence * 1664525) + 1013904223) >>> 0
        if (sequence % 3 === 0) await Promise.resolve()
      }
      return write(key, value, options)
    }
    const users = Array.from({ length: 25 }, (_v, i) =>
      'student_' + String(i).padStart(6, '0'))
    const results = await Promise.allSettled(users.flatMap((uid) =>
      [service.joinCircle(uid, group.inviteCode),
        service.joinCircle(uid, group.inviteCode)]))
    assert.ok(results.every((outcome) => outcome.status === 'fulfilled' ||
      outcome.reason?.code === 'circle_full'))
    const snapshot = await service.getCircle(owner, group.circleId)
    assert.equal(new Set(snapshot.members.map((m) => m.userId)).size,
      snapshot.members.length)
    assert.equal(snapshot.members.length, 12)
  }
})
