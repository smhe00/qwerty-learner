/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCircleEventLog, digest, makeEvent } from '../../cloud-functions/_shared/circle/event-log.js'
import { reduceCircle } from '../../cloud-functions/_shared/circle/reducer.js'
import { createCircleService } from '../../cloud-functions/_shared/circle/service.js'
import { createCircleBlobStorage } from '../../cloud-functions/_shared/circle/blob-storage.js'
import { createCircleService as historicalService } from '../../cloud-functions/_shared/circle/service-cas-historical.js'
import { createCircleBlobStorage as historicalStorage } from '../../cloud-functions/_shared/circle/blob-storage-cas-historical.js'
import { createCircleHttpHandler } from '../../cloud-functions/_shared/circle/http.js'

const owner = 'owner_00000001'
const alice = 'alice_00000001'
const bob = 'bob_000000001'
const day = '2026-10-13'
class EventualBlob {
  objects = new Map()
  hidden = new Set()
  invisible = new Set()
  lostResponse = false
  failList = false
  writes = []
  onGet = null
  async setJSON(key, value, options) {
    // Model overwriting Blob with NO conditional-create primitive.
    assert.equal(options, undefined)
    this.writes.push(key)
    this.objects.set(key, structuredClone(value))
    if (this.lostResponse) { this.lostResponse = false; throw Error('lost response') }
  }
  async list({ prefix, ...options }) {
    assert.deepEqual(options, {})
    if (this.failList) throw Error('outage')
    return { blobs: [...this.objects.keys()].reverse().filter((key) =>
      key.startsWith(prefix) && !this.hidden.has(key)).map((key) => ({ key })) }
  }
  async get(key, options) {
    assert.deepEqual(options, { type: 'json' })
    if (this.onGet) await this.onGet()
    return this.invisible.has(key) ? null : structuredClone(this.objects.get(key) ?? null)
  }
}
function setup({ check, revoke, verifyAchievement } = {}) {
  const blob = new EventualBlob()
  const log = createCircleEventLog(blob)
  const denied = new Set()
  const closed = new Set()
  const retired = new Set()
  const checks = []
  const trustedAccess = {
    async check(c) {
      checks.push(c)
      if (check && await check(c) !== true) return false
      // Test-only reliable authority, explicitly independent of Blob visibility.
      if (closed.has(c.circleId) || retired.has(c.actorUserId) ||
          denied.has(c.circleId + '/' + c.actorUserId)) return false
      if (c.subjects?.some((u) => retired.has(u) || denied.has(c.circleId + '/' + u))) return false
      return true
    },
    async revoke(c) {
      if (revoke && await revoke(c) !== true) return false
      if (c.kind === 'circle') closed.add(c.circleId)
      else denied.add(c.circleId + '/' + c.targetUserId)
      return true
    },
  }
  const service = createCircleService({ log, trustedAccess,
    authenticate: async (token) => { if (token === 'bad') throw Error('bad session'); return { userId: token } },
    inviteKey: 'test-only-server-key-not-a-production-secret',
    verifyAchievement: verifyAchievement || (async () => true) })
  const create = (maxMembers = 12) => service.createCircle(owner,
    { name: 'Circle', operationId: 'create_00001', maxMembers })
  return { blob, log, service, create, denied, closed, retired, checks }
}
const publicView = ({ pending, revoked, ...view }) => ({ ...view, pendingCount: pending.length, revokedCount: revoked.length })
const facts = (blob) => [...blob.objects.values()]
const event = (circleId, actorUserId, type, operationId, payload) =>
  makeEvent({ circleId, actorUserId, type, operationId, payload })

test('all CAS entry points and HTTP enabling are disabled', () => {
  assert.throws(() => createCircleBlobStorage({}), /disabled/)
  assert.throws(() => historicalService({ storage: {} }), /disabled/)
  assert.throws(() => historicalStorage({}), /disabled/)
  assert.throws(() => createCircleHttpHandler({ service: {}, enabled: true }), /gate is closed/)
  assert.throws(() => createCircleService({}), /independent trusted access/)
})

test('create retries use independent physical keys and one logical fact', async () => {
  const { blob, service, create } = setup()
  const results = await Promise.all(Array.from({ length: 100 }, () => create()))
  assert.equal(new Set(blob.writes).size, 100)
  assert.equal(new Set(results.map((r) => r.circleId)).size, 1)
  assert.equal(new Set(results.map((r) => r.inviteCode)).size, 1)
  const view = await service.getCircle(owner, results[0].circleId)
  assert.equal(view.members.length, 1)
  assert.equal(view.final, false)
  assert.equal(view.consistency, 'eventual')
  assert.ok(blob.writes.every((k) => /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/.test(k)))
  assert.equal(JSON.stringify(facts(blob)).includes(results[0].inviteCode), false)
})

test('30 concurrent joins all return pending; visible-set provisional selection converges', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  const actors = Array.from({ length: 30 }, (_, i) => 'student_' + String(i).padStart(5, '0'))
  const results = await Promise.all(actors.map((a) => service.joinCircle(a, c.inviteCode)))
  assert.ok(results.every((r) => r.admission === 'pending' && r.final === false))
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.members.length, 12)
  assert.equal(view.pendingCount, 19)
  assert.ok(view.members.every((m) => m.status === 'provisional'))
  assert.deepEqual(publicView(reduceCircle(c.circleId, facts(blob).reverse())), view)
})

test('late higher-priority join may displace provisional selection; no hard cap claim', async () => {
  const { blob, service, create } = setup()
  const c = await create(2)
  await service.joinCircle(bob, c.inviteCode)
  const early = await service.getCircle(owner, c.circleId)
  await service.joinCircle(alice, c.inviteCode)
  const lateKey = blob.writes.at(-1)
  blob.hidden.add(lateKey)
  assert.deepEqual(await service.getCircle(owner, c.circleId), early)
  blob.hidden.clear()
  const converged = await service.getCircle(owner, c.circleId)
  assert.deepEqual(converged.members.map((m) => m.userId), [owner, alice])
  assert.deepEqual(converged.pendingCount, 1)
  await assert.rejects(service.getCircle(bob, c.circleId), { code: 'not_circle_member' })
})

test('100 logical retries of join/progress/achievement/clap count once', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await Promise.all(Array.from({ length: 100 }, () => service.joinCircle(alice, c.inviteCode)))
  await Promise.all(Array.from({ length: 100 }, () => service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 12, eventId: 'progress_0001' })))
  await Promise.all(Array.from({ length: 100 }, () => service.shareAchievement(alice, c.circleId, 'ACH_MASTERED_100')))
  await Promise.all(Array.from({ length: 100 }, () => service.reactProgress(owner, c.circleId, alice, day)))
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.members.length, 2)
  assert.equal(view.progress.length, 1)
  assert.equal(view.achievements.length, 1)
  assert.equal(view.claps.length, 1)
  assert.equal(view.progress[0].selfReported, true)
  assert.equal(new Set(blob.writes).size, blob.writes.length)
})

test('ambiguous response commits, same logical retry converges without readback/CAS', async () => {
  const { blob, service, create } = setup()
  blob.lostResponse = true
  await assert.rejects(create(), { code: 'circle_append_unknown' })
  const c = await create()
  assert.equal(facts(blob).length, 2)
  assert.equal((await service.getCircle(owner, c.circleId)).conflicts.length, 0)
})

test('same logical operation with conflicting content quarantines view in every order', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 12, eventId: 'progress_0001' })
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 13, eventId: 'progress_0001' })
  const view = publicView(reduceCircle(c.circleId, facts(blob)))
  assert.equal(view.blocked, true)
  assert.equal(view.conflicts.length, 1)
  assert.equal(view.progress.length, 0)
  assert.deepEqual(publicView(reduceCircle(c.circleId, facts(blob).reverse())), view)
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_view_uncertain' })
})

test('reordering, duplicate observations, late creation and incremental visibility rebuild same view', async () => {
  const { blob, service, create, log } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 12, eventId: 'progress_0001' })
  await service.reactProgress(owner, c.circleId, alice, day)
  const all = facts(blob)
  const expected = reduceCircle(c.circleId, all)
  assert.equal(reduceCircle(c.circleId, all.slice(1)).blocked, true)
  for (let shift = 0; shift < all.length; shift++) {
    const reordered = [...all.slice(shift), ...all.slice(0, shift)]
    assert.deepEqual(reduceCircle(c.circleId, [...reordered, ...reordered]), expected)
  }
  blob.invisible.add(blob.writes[0])
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_view_uncertain' })
  blob.invisible.clear()
  // Disposable materialized view can be discarded and rebuilt from the log.
  const cache = new Map([[c.circleId, expected]])
  cache.clear()
  cache.set(c.circleId, reduceCircle(c.circleId, await log.scan(c.circleId)))
  assert.deepEqual(cache.get(c.circleId), expected)
})

test('leave/remove are permanent remove-wins and filter progress, achievements and claps', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 1, eventId: 'progress_0001' })
  await service.shareAchievement(alice, c.circleId, 'ACH_MASTERED_100')
  await service.reactProgress(owner, c.circleId, alice, day)
  await assert.rejects(service.removeMember(alice, c.circleId, owner), { code: 'not_circle_owner' })
  await assert.rejects(service.leaveCircle(owner, c.circleId), { code: 'owner_cannot_leave' })
  await service.removeMember(owner, c.circleId, alice)
  const view = await service.getCircle(owner, c.circleId)
  assert.deepEqual(view.revokedCount, 1)
  assert.equal(view.progress.length + view.achievements.length + view.claps.length, 0)
  await assert.rejects(service.joinCircle(alice, c.inviteCode), { code: 'circle_access_uncertain' })
  assert.deepEqual(publicView(reduceCircle(c.circleId, facts(blob).reverse())), view)
})

test('member leave fences first, then logs; delayed leave cannot restore access', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.leaveCircle(alice, c.circleId)
  blob.hidden.add(blob.writes.at(-1))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
  // Old visible membership causes the whole protected view to fail closed.
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
  blob.hidden.clear()
  assert.deepEqual((await service.getCircle(owner, c.circleId)).revokedCount, 1)
})

test('close wins over delayed joins and progress; private reads fenced despite hidden close', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.closeCircle(owner, c.circleId)
  blob.hidden.add(blob.writes.at(-1))
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
  const creation = facts(blob)[0]
  const delayedJoin = event(c.circleId, alice, 'JOIN_REQUESTED', 'join_request',
    { inviteHash: creation.payload.inviteHash })
  const view = reduceCircle(c.circleId, [...facts(blob), delayedJoin])
  assert.equal(view.closed, true)
  assert.deepEqual(view.members, [])
})

test('independent authority denies in-flight reads and retired subjects under stale listings', async () => {
  const { blob, service, create, retired } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  blob.onGet = async () => retired.add(alice)
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
  blob.onGet = null
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
})

test('authorization rechecks caller identity before returning private data', async () => {
  let deny = false
  const { service, create } = setup({ check: async (c) => {
    if (deny && c.phase === 'before_return') return false
    return true
  } })
  const c = await create()
  deny = true
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
})

test('missing/unavailable revocation fence never emits revoke event', async () => {
  const { blob, service, create } = setup({ revoke: async () => false })
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const before = blob.writes.length
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_revocation_unavailable' })
  assert.equal(blob.writes.length, before)
})

test('lost revoke-log response leaves authoritative fence intact, not falsely acknowledged', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  blob.lostResponse = true
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  blob.hidden.add(blob.writes.at(-1))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
})

test('authentication, unknown access, fake invite and evidence verification fail closed', async () => {
  const { service, create } = setup({ verifyAchievement: async () => false })
  const c = await create()
  await assert.rejects(service.getCircle('bad', c.circleId))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'not_circle_member' })
  await assert.rejects(service.joinCircle(alice, c.inviteCode.slice(0, -1) + 'z'), { code: 'invalid_invite' })
  await assert.rejects(service.shareAchievement(owner, c.circleId, 'ACH_MASTERED_100'), { code: 'achievement_unverified' })
  const denied = setup({ check: async () => undefined })
  await assert.rejects(denied.create(), { code: 'circle_access_uncertain' })
})

test('nonowner removal/closure events cannot change membership in reducer', async () => {
  const { blob, create } = setup()
  const c = await create()
  const forged = [
    event(c.circleId, alice, 'MEMBER_REMOVED', 'remove_00001', { targetUserId: owner }),
    event(c.circleId, alice, 'CIRCLE_CLOSED', 'close_circle', {}),
  ]
  const view = reduceCircle(c.circleId, [...facts(blob), ...forged])
  assert.equal(view.closed, false)
  assert.deepEqual(view.revoked, [])
})

test('log rejects key escapes, misplaced data, unconsumed pages and overload', async () => {
  const { blob, log, create } = setup()
  const c = await create()
  await assert.rejects(log.scan('../accounts'), /Invalid circle/)
  const list = blob.list.bind(blob)
  blob.list = async () => ({ blobs: [{ key: 'accounts/private.json' }] })
  await assert.rejects(log.scan(c.circleId), /Out-of-scope/)
  blob.list = async () => ({ blobs: [], nextCursor: 'more' })
  await assert.rejects(log.scan(c.circleId), /Incomplete/)
  blob.list = list
  const wrong = structuredClone(facts(blob)[0])
  wrong.circleId = 'another_circle'
  wrong.dedupKey = digest([wrong.circleId, wrong.actorUserId, wrong.type, wrong.operationId])
  blob.objects.set(blob.writes[0], wrong)
  await assert.rejects(log.scan(c.circleId), /identity mismatch/)
})

test('malformed facts and same physical ID with changed payload fail closed', async () => {
  const { blob, create } = setup()
  const c = await create()
  const e = facts(blob)[0]
  const bad = { ...e, payload: { ...e.payload, name: 'different' } }
  assert.throws(() => reduceCircle(c.circleId, [e, bad]), /Physical event collision/)
  assert.throws(() => reduceCircle(c.circleId, [{ ...e, dedupKey: 'fake' }]), /Invalid Circle event/)
})

test('listing outage is not an empty membership or successful projection', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  blob.failList = true
  await assert.rejects(service.getCircle(owner, c.circleId), /outage/)
})

test('progress rejects impossible dates and invalid command IDs', async () => {
  const { service, create } = setup()
  const c = await create()
  await assert.rejects(service.publishProgress(owner, c.circleId, '2026-02-30',
    { completed: true, newWords: 1, eventId: 'progress_0001' }), { code: 'invalid_progress' })
  await assert.rejects(service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 1, eventId: '../secret' }), { code: 'circle_operation_id_required' })
})


test('pending and revoked identities are not included in member-facing views', async () => {
  const { service, create, retired } = setup()
  const c = await create(2)
  await service.joinCircle(alice, c.inviteCode)
  await service.joinCircle(bob, c.inviteCode)
  retired.add(bob)
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.pendingCount, 1)
  assert.equal(JSON.stringify(view).includes(bob), false)
  retired.clear()
  await service.removeMember(owner, c.circleId, alice)
  const after = await service.getCircle(owner, c.circleId)
  assert.equal(after.revokedCount, 1)
  assert.equal(JSON.stringify(after).includes(alice), false)
})

test('replay budget exceeded fails closed without silently truncating events', async () => {
  const { blob, create } = setup()
  const c = await create()
  await create()
  const limited = createCircleEventLog(blob, { maxEvents: 1 })
  await assert.rejects(limited.scan(c.circleId), /budget exceeded/)
})

test('fence succeeds but append fails before commit: access remains denied, reconciliation required', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const before = blob.writes.length
  blob.setJSON = async () => { throw Error('pre-commit outage') }
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  assert.equal(blob.writes.length, before)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
})

test('verified progress/achievement publication never receives client identity fields', async () => {
  const { service, create } = setup()
  const c = await create()
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 3, eventId: 'progress_0001', actorUserId: alice, verified: true })
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.progress[0].authorUserId, owner)
  assert.equal(view.progress[0].selfReported, true)
})
