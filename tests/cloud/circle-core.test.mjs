/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ReadableStream } from 'node:stream/web'
import { createCircleEventLog, digest, makeEvent } from '../../cloud-functions/_shared/circle/event-log.js'
import { createCircleRevocationCoordinator, revocationCommand } from '../../cloud-functions/_shared/circle/revocation.js'
import { createCirclePrivacyMaintenance } from '../../cloud-functions/_shared/circle/privacy.js'
import { reduceCircle } from '../../cloud-functions/_shared/circle/reducer.js'
import { createCircleService } from '../../cloud-functions/_shared/circle/service.js'
import { createCircleBlobStorage } from '../../cloud-functions/_shared/circle/blob-storage.js'
import { createCircleService as historicalService } from '../../cloud-functions/_shared/circle/service-cas-historical.js'
import { createCircleBlobStorage as historicalStorage } from '../../cloud-functions/_shared/circle/blob-storage-cas-historical.js'
import { createCircleTransport } from '../../cloud-functions/_shared/circle/transport.js'
import { AppError } from '../../cloud-functions/_shared/core.js'
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
  lostResponseType = null
  failList = false
  writes = []
  onGet = null
  async setJSON(key, value, options) {
    // Model overwriting Blob with NO conditional-create primitive.
    assert.equal(options, undefined)
    this.writes.push(key)
    this.objects.set(key, structuredClone(value))
    if (this.lostResponse && (!this.lostResponseType || value.type === this.lostResponseType)) { this.lostResponse = false; throw Error('lost response') }
  }
  async delete(key) { this.objects.delete(key) }
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
function setup({ check, revoke } = {}) {
  const blob = new EventualBlob()
  const log = createCircleEventLog(blob)
  const denied = new Set()
  const closed = new Set()
  const retired = new Set()
  const checks = []
  const receipts = new Map()
  const retirements = new Map()
  const trustedAccess = {
    async check(c) {
      checks.push(c)
      if (check && await check(c) !== true) return false
      // Test-only reliable authority, explicitly independent of Blob visibility.
      if (closed.has(c.circleId) || retired.has(c.actorUserId) || retirements.get(c.actorUserId)?.status === 'retired' ||
          denied.has(c.circleId + '/' + c.actorUserId)) return false
      if (c.subjects?.some((u) => retired.has(u) || retirements.get(u)?.status === 'retired' || denied.has(c.circleId + '/' + u))) return false
      return true
    },
    async revoke(c) {
      if (revoke && await revoke(c) !== true) return false
      if (c.kind === 'circle') closed.add(c.circleId)
      else denied.add(c.circleId + '/' + c.targetUserId)
      receipts.set(c.operationId, { status: 'committed', operationId: c.operationId, commandHash: c.commandHash })
      return true
    },
  }
  trustedAccess.lookupRevocation = async ({ operationId }) => structuredClone(receipts.get(operationId) ?? null)
  trustedAccess.lookupRetirement = async ({ userId }) => structuredClone(retirements.get(userId) ?? null)
  trustedAccess.authorizeMaintenance = async ({ subjects }) => !subjects?.some((u) => retired.has(u) || retirements.get(u)?.status === 'retired')
  const service = createCircleService({ log, trustedAccess,
    authenticate: async (token) => { if (token === 'bad') throw Error('bad session'); return { userId: token } },
    inviteKey: 'test-only-server-key-not-a-production-secret',
  })
  const create = (softMemberLimit = 12) => service.createCircle(owner,
    { name: 'Circle', operationId: 'create_00001', softMemberLimit })
  return { blob, log, service, create, denied, closed, retired, checks, trustedAccess, receipts, retirements }
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

test('30 concurrent joins converge without seats or overflow waiting list', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  const actors = Array.from({ length: 30 }, (_, i) => 'student_' + String(i).padStart(5, '0'))
  const results = await Promise.all(actors.map((a) => service.joinCircle(a, c.inviteCode)))
  assert.ok(results.every((r) => r.admission === 'pending' && r.final === false))
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.members.length, 31)
  assert.equal(view.pendingCount, 0)
  assert.equal(view.capacity.aboveSoftLimit, true)
  assert.equal(view.capacity.hardLimit, false)
  assert.ok(view.members.every((m) => m.status === 'member'))
  assert.deepEqual(publicView(reduceCircle(c.circleId, facts(blob).reverse())), view)
})

test('late visible joins do not displace members even above a soft limit of two', async () => {
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
  assert.deepEqual(converged.members.map((m) => m.userId), [owner, alice, bob])
  assert.equal(converged.pendingCount, 0)
  assert.equal(converged.capacity.memberCount, 3)
  assert.equal(converged.capacity.aboveSoftLimit, true)
  assert.equal((await service.getCircle(bob, c.circleId)).members.length, 3)
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

test('conflicting self-report is omitted without disabling the circle in any order', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 12, eventId: 'progress_0001' })
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 13, eventId: 'progress_0001' })
  const view = publicView(reduceCircle(c.circleId, facts(blob)))
  assert.equal(view.blocked, undefined)
  assert.equal(view.conflicts.length, 1)
  assert.equal(view.ignoredActivityConflicts, 1)
  assert.equal(view.blockingConflicts.length, 0)
  assert.equal(view.progress.length, 0)
  assert.deepEqual(publicView(reduceCircle(c.circleId, facts(blob).reverse())), view)
  assert.deepEqual(await service.getCircle(owner, c.circleId), view)
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 15, eventId: 'progress_0002' })
  assert.equal((await service.getCircle(owner, c.circleId)).progress[0].newWords, 15)
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

test('listed but unreadable event fails closed instead of omitting a privacy-critical fact', async () => {
  const { blob, service, create, log } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 11, eventId: 'progress_0001' })
  const unreadableKey = blob.writes.at(-1)
  blob.invisible.add(unreadableKey)
  // The listing advertises this key; do not silently present a partial view.
  await assert.rejects(log.scan(c.circleId), /listed event temporarily unreadable/)
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_view_uncertain' })
  blob.invisible.clear()
  const recovered = await service.getCircle(owner, c.circleId)
  assert.equal(recovered.progress.length, 1)
  assert.equal(recovered.progress[0].newWords, 11)
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

test('unavailable revocation fence leaves only an inert intent, never a final revoke', async () => {
  const { blob, service, create } = setup({ revoke: async () => false })
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const before = blob.writes.length
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_revocation_unavailable' })
  assert.equal(blob.writes.length, before + 1)
})

test('lost revoke-log response leaves authoritative fence intact, not falsely acknowledged', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  blob.lostResponse = true
  blob.lostResponseType = 'MEMBER_REMOVED'
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  blob.hidden.add(blob.writes.at(-1))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
})

test('authentication, unknown access and fake invite still fail closed in light social mode', async () => {
  const { service, create } = setup()
  const c = await create()
  await assert.rejects(service.getCircle('bad', c.circleId))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'not_circle_member' })
  await assert.rejects(service.joinCircle(alice, c.inviteCode.slice(0, -1) + 'z'), { code: 'invalid_invite' })
  await service.shareAchievement(owner, c.circleId, 'ACH_MASTERED_100')
  assert.equal((await service.getCircle(owner, c.circleId)).achievements[0].verified, false)
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
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_view_uncertain' })
})

test('progress rejects impossible dates and invalid command IDs', async () => {
  const { service, create } = setup()
  const c = await create()
  await assert.rejects(service.publishProgress(owner, c.circleId, '2026-02-30',
    { completed: true, newWords: 1, eventId: 'progress_0001' }), { code: 'invalid_progress' })
  await assert.rejects(service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 1, eventId: '../secret' }), { code: 'circle_operation_id_required' })
})


test('removed identities stay hidden while soft-limit members remain visible', async () => {
  const { service, create } = setup()
  const c = await create(2)
  await service.joinCircle(alice, c.inviteCode)
  await service.joinCircle(bob, c.inviteCode)
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.pendingCount, 0)
  assert.equal(view.members.length, 3)
  await service.removeMember(owner, c.circleId, alice)
  const after = await service.getCircle(owner, c.circleId)
  assert.equal(after.revokedCount, 1)
  assert.equal(JSON.stringify(after).includes(alice), false)
  assert.equal(after.members.some((m) => m.userId === bob), true)
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
  const set = blob.setJSON.bind(blob)
  blob.setJSON = async (key, value) => {
    if (value.type === 'MEMBER_REMOVED') throw Error('pre-commit outage')
    return set(key, value)
  }
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  assert.equal(blob.writes.length, before + 1)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
})

test('self-reported publication never receives client identity or verified fields', async () => {
  const { service, create } = setup()
  const c = await create()
  await service.publishProgress(owner, c.circleId, day,
    { completed: true, newWords: 3, eventId: 'progress_0001', actorUserId: alice, verified: true })
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.progress[0].authorUserId, owner)
  assert.equal(view.progress[0].selfReported, true)
})


test('recovery after successful fence and failed append restores usable view after restart', async () => {
  const { blob, service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const set = blob.setJSON.bind(blob)
  blob.setJSON = async (key, value) => {
    if (value.type === 'MEMBER_REMOVED') throw Error('crash after fence')
    return set(key, value)
  }
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
  blob.setJSON = set
  // Fresh coordinator has no in-memory command, cursor, lock or queue state.
  const restarted = createCircleRevocationCoordinator({ log, trustedAccess })
  const receipt = await restarted.recover(c.circleId)
  assert.equal(receipt.appended, 1)
  assert.equal(receipt.fullyRecovered, false)
  assert.equal((await service.getCircle(owner, c.circleId)).revokedCount, 1)
  const again = await restarted.recover(c.circleId)
  assert.equal(again.appended, 0)
  assert.equal(again.alreadyVisible, 1)
})

test('intent append unknown never calls fence; retry and duplicate intent fold once', async () => {
  const { blob, service, create, receipts, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  blob.lostResponse = true
  blob.lostResponseType = 'REVOCATION_INTENDED'
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_append_unknown' })
  assert.equal(receipts.size, 0)
  assert.equal((await service.getCircle(alice, c.circleId)).members.length, 2)
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  assert.equal((await recovery.recover(c.circleId)).deferred, 1)
  await service.removeMember(owner, c.circleId, alice)
  assert.equal((await recovery.recover(c.circleId)).observed, 1)
  assert.equal((await service.getCircle(owner, c.circleId)).revokedCount, 1)
})

test('fence response lost is recovered only using reliable bound receipt', async () => {
  const { service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const revoke = trustedAccess.revoke.bind(trustedAccess)
  trustedAccess.revoke = async (command) => { await revoke(command); throw Error('lost fence response') }
  await assert.rejects(service.removeMember(owner, c.circleId, alice), { code: 'circle_revocation_unknown' })
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  assert.equal((await recovery.recover(c.circleId)).appended, 1)
  assert.equal((await service.getCircle(owner, c.circleId)).revokedCount, 1)
})

test('100 recovery workers with hidden final events converge without leases or locks', async () => {
  const { blob, service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.removeMember(owner, c.circleId, alice)
  for (const [key, e] of blob.objects) if (e.type === 'MEMBER_REMOVED') blob.hidden.add(key)
  const worker = () => createCircleRevocationCoordinator({ log, trustedAccess }).recover(c.circleId)
  await Promise.all(Array.from({ length: 100 }, worker))
  blob.hidden.clear()
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.revokedCount, 1)
  assert.equal(view.members.length, 1)
  assert.equal(new Set(blob.writes).size, blob.writes.length)
  assert.deepEqual(reduceCircle(c.circleId, facts(blob)), reduceCircle(c.circleId, facts(blob).reverse()))
})

test('unfenced forged intent cannot revoke despite maintenance privileges', async () => {
  const { service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const command = revocationCommand({ circleId: c.circleId, actorUserId: owner,
    type: 'MEMBER_REMOVED', targetUserId: alice })
  await log.append({ circleId: c.circleId, actorUserId: owner, type: 'REVOCATION_INTENDED',
    operationId: digest(['circle-revocation-v1', command]), payload: { command } })
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  assert.equal((await recovery.recover(c.circleId)).deferred, 1)
  assert.equal((await service.getCircle(alice, c.circleId)).members.length, 2)
})

test('receipt bound to another command, actor or circle fails closed', async () => {
  const { service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.removeMember(owner, c.circleId, alice)
  trustedAccess.lookupRevocation = async ({ operationId }) =>
    ({ operationId, status: 'committed', commandHash: digest('another command') })
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_revocation_receipt_invalid' })
})

test('maintenance denial happens before scan; permission loss during scan stops replay', async () => {
  const { blob, service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.removeMember(owner, c.circleId, alice)
  blob.hidden.add(blob.writes.at(-1))
  trustedAccess.authorizeMaintenance = async () => false
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  const before = blob.writes.length
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_maintenance_denied' })
  trustedAccess.authorizeMaintenance = async () => true
  blob.onGet = async () => { trustedAccess.authorizeMaintenance = async () => false }
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_maintenance_denied' })
  assert.equal(blob.writes.length, before)
})

test('delayed intent can be recovered later; a partial scan never reports completion', async () => {
  const { blob, service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.removeMember(owner, c.circleId, alice)
  for (const [key, e] of blob.objects) if (e.type === 'REVOCATION_INTENDED') blob.hidden.add(key)
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  const partial = await recovery.recover(c.circleId)
  assert.equal(partial.observed, 0)
  assert.equal(partial.snapshotOnly, true)
  assert.equal(partial.fullyRecovered, false)
  blob.hidden.clear()
  assert.equal((await recovery.recover(c.circleId)).alreadyVisible, 1)
})

test('leave and closure recover with original actor even after actor access is fenced', async () => {
  for (const mode of ['leave', 'close']) {
    const { blob, service, create, log, trustedAccess } = setup()
    const c = await create()
    await service.joinCircle(alice, c.inviteCode)
    const finalType = mode === 'leave' ? 'MEMBER_LEFT' : 'CIRCLE_CLOSED'
    const set = blob.setJSON.bind(blob)
    blob.setJSON = async (key, value) => {
      if (value.type === finalType) throw Error('crash')
      return set(key, value)
    }
    await assert.rejects(mode === 'leave'
      ? service.leaveCircle(alice, c.circleId) : service.closeCircle(owner, c.circleId),
    { code: 'circle_append_unknown' })
    blob.setJSON = set
    const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
    assert.equal((await recovery.recover(c.circleId)).appended, 1)
    const view = reduceCircle(c.circleId, facts(blob))
    if (mode === 'leave') assert.deepEqual(view.revoked, [alice])
    else assert.equal(view.closed, true)
  }
})

test('malformed or conflicting intent is blocked without executing arbitrary activity', async () => {
  const { blob, create, log, trustedAccess } = setup()
  const c = await create()
  const command = revocationCommand({ circleId: c.circleId, actorUserId: owner,
    type: 'CIRCLE_CLOSED' })
  const operationId = digest(['circle-revocation-v1', command])
  await log.append({ circleId: c.circleId, actorUserId: owner,
    type: 'REVOCATION_INTENDED', operationId, payload: { command } })
  await log.append({ circleId: c.circleId, actorUserId: owner,
    type: 'REVOCATION_INTENDED', operationId, payload: { command: { ...command, type: 'CLAP_ADDED' } } })
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  const before = blob.writes.length
  assert.equal((await recovery.recover(c.circleId)).blocked, 1)
  assert.equal(blob.writes.length, before)
})

test('authority outage and unknown lookup cannot be treated as committed receipt', async () => {
  const { service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.closeCircle(owner, c.circleId)
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  trustedAccess.lookupRevocation = async () => undefined
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_revocation_receipt_invalid' })
  trustedAccess.lookupRevocation = async () => { throw Error('authority unavailable') }
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_revocation_receipt_unavailable' })
})

test('recovering an acknowledged but invisible final append is safe on retry', async () => {
  const { blob, service, create, log, trustedAccess } = setup()
  const c = await create()
  await service.closeCircle(owner, c.circleId)
  const finalKey = blob.writes.at(-1)
  blob.hidden.add(finalKey)
  blob.lostResponse = true
  blob.lostResponseType = 'CIRCLE_CLOSED'
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_append_unknown' })
  await recovery.recover(c.circleId)
  blob.hidden.clear()
  assert.equal(reduceCircle(c.circleId, facts(blob)).closed, true)
})



test('retirement scrub removes actor and target records, including nested revocation intents', async () => {
  const { blob, service, create, log, trustedAccess, retired, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 1, eventId: 'progress_0001' })
  await service.shareAchievement(alice, c.circleId, 'ACH_MASTERED_100')
  await service.reactProgress(owner, c.circleId, alice, day)
  await service.removeMember(owner, c.circleId, alice)
  retired.add(alice)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  const before = await cleanup.auditAccount(c.circleId, alice)
  assert.equal(before.residualObjects, 6)
  const report = await cleanup.scrubAccount(c.circleId, alice)
  assert.equal(report.deleteAcknowledged, 6)
  assert.equal(report.residualObjects, 0)
  assert.equal(report.fullyErased, false)
  assert.equal(report.followUpRequired, true)
  assert.equal(JSON.stringify(facts(blob)).includes(alice), false)
  assert.equal((await service.getCircle(owner, c.circleId)).members.length, 1)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_access_uncertain' })
})

test('active-account cleanup denied before any scan or delete', async () => {
  const { blob, create, log, trustedAccess } = setup()
  const c = await create()
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  const before = blob.objects.size
  blob.list = async () => { throw Error('must not scan') }
  await assert.rejects(cleanup.scrubAccount(c.circleId, owner), { code: 'circle_retirement_uncertain' })
  assert.equal(blob.objects.size, before)
})

test('hidden retired activity and delayed pre-fence write require repeated cleanup', async () => {
  const { blob, service, create, log, trustedAccess, retired, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  retired.add(alice)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const joinKey = blob.writes.at(-1)
  blob.hidden.add(joinKey)
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  const early = await cleanup.scrubAccount(c.circleId, alice)
  assert.equal(early.residualObjects, 0)
  assert.equal(early.fullyErased, false)
  blob.hidden.clear()
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_access_uncertain' })
  assert.equal((await cleanup.scrubAccount(c.circleId, alice)).deleteAcknowledged, 1)
  // Simulation of a request accepted before retirement, landing after cleanup.
  await log.append({ circleId: c.circleId, actorUserId: alice, type: 'PROGRESS_PUBLISHED',
    operationId: 'late_progress_01', payload: { day, completed: true, newWords: 1 } })
  assert.equal((await cleanup.auditAccount(c.circleId, alice)).residualObjects, 1)
  assert.equal((await cleanup.scrubAccount(c.circleId, alice)).deleteAcknowledged, 1)
})

test('retired owner cleanup intentionally makes circle unavailable; no owner replacement inferred', async () => {
  const { service, create, log, trustedAccess, retired, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  retired.add(owner)
  retirements.set(owner, { userId: owner, status: 'retired', fenceId: 'fence_owner_01' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  await cleanup.scrubAccount(c.circleId, owner)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'circle_view_uncertain' })
})

test('maintenance permission loss or changed retirement fence halts destructive work', async () => {
  const { blob, service, create, log, trustedAccess, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  const before = blob.objects.size
  trustedAccess.authorizeMaintenance = async () => false
  await assert.rejects(cleanup.scrubAccount(c.circleId, alice), { code: 'circle_maintenance_denied' })
  trustedAccess.authorizeMaintenance = async () => true
  blob.onGet = async () => retirements.set(alice,
    { userId: alice, status: 'retired', fenceId: 'changed_fence_01' })
  await assert.rejects(cleanup.scrubAccount(c.circleId, alice), { code: 'circle_retirement_uncertain' })
  assert.equal(blob.objects.size, before)
})

test('delete failure is not acknowledged; retry resumes from retained immutable events', async () => {
  const { blob, service, create, log, trustedAccess, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  const remove = blob.delete.bind(blob)
  blob.delete = async () => { throw Error('delete outage') }
  await assert.rejects(cleanup.scrubAccount(c.circleId, alice), /delete outage/)
  blob.delete = remove
  assert.equal((await cleanup.scrubAccount(c.circleId, alice)).deleteAcknowledged, 1)
})

test('delete acknowledgement with stale visibility retains honest residual audit', async () => {
  const { blob, service, create, log, trustedAccess, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  blob.delete = async () => {} // provider ack, old event still visible
  const report = await cleanup.scrubAccount(c.circleId, alice)
  assert.equal(report.deleteAcknowledged, 1)
  assert.equal(report.residualObjects, 1)
  assert.equal(report.fullyErased, false)
})

test('cleanup only affects chosen circle; raw deletion cannot escape social/v2 event scope', async () => {
  const { blob, service, create, log, trustedAccess, retirements } = setup()
  const c = await create()
  const other = await service.createCircle(owner, { name: 'Other', operationId: 'create_other_01' })
  await service.joinCircle(alice, c.inviteCode)
  await service.joinCircle(alice, other.inviteCode)
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  await cleanup.scrubAccount(c.circleId, alice)
  assert.equal(facts(blob).filter((e) => e.actorUserId === alice && e.circleId === other.circleId).length, 1)
  await assert.rejects(log.eraseEvent(c.circleId, '../accounts'), /Invalid event deletion/)
  await assert.rejects(log.eraseEvent('../accounts', 'a'.repeat(32)), /Invalid circle/)
})

test('retirement lookup must bind account and fail closed when authority is unavailable', async () => {
  const { create, log, trustedAccess } = setup()
  const c = await create()
  const cleanup = createCirclePrivacyMaintenance({ log, trustedAccess })
  trustedAccess.lookupRetirement = async () =>
    ({ status: 'retired', userId: alice, fenceId: 'fence_000001' })
  await assert.rejects(cleanup.auditAccount(c.circleId, owner), { code: 'circle_retirement_uncertain' })
  trustedAccess.lookupRetirement = async () => { throw Error('authority outage') }
  await assert.rejects(cleanup.auditAccount(c.circleId, owner), /authority outage/)
})


test('retirement fence blocks recovery from recreating a deleted identity reference', async () => {
  const { blob, service, create, log, trustedAccess, retirements } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.removeMember(owner, c.circleId, alice)
  blob.hidden.add(blob.writes.at(-1))
  retirements.set(alice, { userId: alice, status: 'retired', fenceId: 'fence_000001' })
  const before = blob.writes.length
  const recovery = createCircleRevocationCoordinator({ log, trustedAccess })
  await assert.rejects(recovery.recover(c.circleId), { code: 'circle_maintenance_denied' })
  assert.equal(blob.writes.length, before)
})

test('soft member hint accepts legacy input without imposing a limit', async () => {
  const { blob, service } = setup()
  const c = await service.createCircle(owner, { name: 'Soft', operationId: 'legacy_create_01', maxMembers: 2 })
  await service.joinCircle(alice, c.inviteCode)
  await service.joinCircle(bob, c.inviteCode)
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.meta.softMemberLimit, 2)
  assert.equal(view.capacity.hardLimit, false)
  assert.equal(view.members.length, 3)
  const creation = facts(blob).find((e) => e.type === 'CIRCLE_CREATED')
  assert.equal(creation.payload.maxMembers, undefined)
  assert.equal(creation.payload.softMemberLimit, 2)
  await assert.rejects(service.createCircle(owner,
    { name: 'Bad', operationId: 'bad_create_0001', softMemberLimit: 2, maxMembers: 4 }),
  { code: 'invalid_circle_input' })
  await assert.rejects(service.createCircle(owner,
    { name: 'Bad', operationId: 'bad_create_0002', softMemberLimit: -1 }),
  { code: 'invalid_circle_input' })
})

test('historical creation maxMembers is replayed as a soft hint only', async () => {
  const { blob, service, create } = setup()
  const c = await create(2)
  await service.joinCircle(alice, c.inviteCode)
  await service.joinCircle(bob, c.inviteCode)
  const events = facts(blob)
  const legacy = structuredClone(events[0])
  legacy.payload.maxMembers = legacy.payload.softMemberLimit
  delete legacy.payload.softMemberLimit
  const view = reduceCircle(c.circleId, [legacy, ...events.slice(1)])
  assert.equal(view.members.length, 3)
  assert.equal(view.pending.length, 0)
  assert.equal(view.capacity.aboveSoftLimit, true)
  assert.equal(view.meta.softMemberLimit, 2)
})

test('daily encouragement merges completed OR and highest self-report without summing updates', async () => {
  const { blob, service, create } = setup()
  const c = await create()
  for (const [i, completed, newWords] of [[1, false, 4], [2, true, 8], [3, false, 32], [4, false, 6]]) {
    await service.publishProgress(owner, c.circleId, day,
      { eventId: 'daily_event_000' + i, completed, newWords })
  }
  const view = await service.getCircle(owner, c.circleId)
  assert.deepEqual(view.progress, [{ authorUserId: owner, day, completed: true, newWords: 32, selfReported: true }])
  assert.deepEqual(reduceCircle(c.circleId, facts(blob)), reduceCircle(c.circleId, facts(blob).reverse()))
  assert.deepEqual(await service.getProgress(owner, c.circleId, day), view.progress)
})

test('soft achievements need no evidence provider and never issue a verified badge', async () => {
  const { service, create, log, trustedAccess } = setup()
  const c = await create()
  let evidenceCalls = 0
  const light = createCircleService({ log, trustedAccess,
    authenticate: async (token) => ({ userId: token }),
    inviteKey: 'test-only-server-key-not-a-production-secret',
    verifyAchievement: async () => { evidenceCalls++; throw Error('must not call external evidence') } })
  await light.shareAchievement(owner, c.circleId, 'ACH_MASTERED_100')
  assert.equal(evidenceCalls, 0)
  await assert.rejects(light.shareAchievement(owner, c.circleId, ['ACH_MASTERED_100']), { code: 'invalid_achievement' })
  const entries = await service.getShowcase(owner, c.circleId, owner)
  assert.deepEqual(entries, [{ authorUserId: owner, achievementId: 'ACH_MASTERED_100',
    selfReported: true, verified: false }])
  await assert.rejects(service.shareAchievement(owner, c.circleId,
    { achievementId: 'ACH_MASTERED_100', verified: true }), { code: 'invalid_achievement' })
})

test('historical verified and new social shares fold to one nonauthoritative display', async () => {
  const { service, create, log } = setup()
  const c = await create()
  await log.append({ circleId: c.circleId, actorUserId: owner, type: 'ACHIEVEMENT_SHARED',
    operationId: digest(['achievement', 'ACH_MASTERED_100']),
    payload: { achievementId: 'ACH_MASTERED_100', verified: true } })
  await service.shareAchievement(owner, c.circleId, 'ACH_MASTERED_100')
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.achievements.length, 1)
  assert.equal(view.achievements[0].verified, false)
  assert.equal(view.achievements[0].selfReported, true)
  assert.equal(view.ignoredActivityConflicts, 0)
})

test('small read APIs retain private membership guards and remove target activity after revocation', async () => {
  const { service, create } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 8, eventId: 'progress_0001' })
  await service.shareAchievement(alice, c.circleId, 'ACH_MASTERED_100')
  await service.reactProgress(owner, c.circleId, alice, day)
  assert.equal((await service.getProgress(owner, c.circleId, day)).length, 1)
  assert.deepEqual(await service.getReactions(owner, c.circleId, alice, day), { count: 1, consistency: 'eventual' })
  assert.equal((await service.getShowcase(owner, c.circleId, alice, ['ACH_MASTERED_100'])).length, 1)
  await assert.rejects(service.getProgress('visitor_00001', c.circleId, day), { code: 'not_circle_member' })
  await assert.rejects(service.getReactions('visitor_00001', c.circleId, alice, day), { code: 'not_circle_member' })
  await assert.rejects(service.getShowcase('visitor_00001', c.circleId, alice), { code: 'not_circle_member' })
  await service.removeMember(owner, c.circleId, alice)
  assert.deepEqual(await service.getProgress(owner, c.circleId, day), [])
  await assert.rejects(service.getReactions(owner, c.circleId, alice, day), { code: 'progress_not_found' })
  await assert.rejects(service.getShowcase(owner, c.circleId, alice), { code: 'member_not_found' })
})

test('light read queries validate dates, identifier arrays and bounded input', async () => {
  const { service, create } = setup()
  const c = await create()
  await assert.rejects(service.getProgress(owner, c.circleId, '2026-02-30'), { code: 'invalid_day' })
  await assert.rejects(service.getReactions(owner, c.circleId, owner, 'invalid'), { code: 'invalid_day' })
  await assert.rejects(service.getShowcase(owner, c.circleId, owner, ['../accounts']), { code: 'invalid_achievement' })
  await assert.rejects(service.getShowcase(owner, c.circleId, owner, Array(25).fill('ACH_MASTERED_100')),
    { code: 'invalid_achievement' })
})

test('overflow never removes prior progress or blocks an existing member posting', async () => {
  const { service, create } = setup()
  const c = await create(2)
  await service.joinCircle(bob, c.inviteCode)
  await service.publishProgress(bob, c.circleId, day,
    { completed: true, newWords: 8, eventId: 'progress_0001' })
  await service.joinCircle(alice, c.inviteCode)
  await service.shareAchievement(bob, c.circleId, 'ACH_MASTERED_100')
  const view = await service.getCircle(bob, c.circleId)
  assert.equal(view.capacity.aboveSoftLimit, true)
  assert.equal(view.progress[0].authorUserId, bob)
  assert.equal(view.achievements[0].authorUserId, bob)
})

test('light social conflict isolation does not weaken creation or revocation integrity', async () => {
  const { blob, create } = setup()
  const c = await create()
  const creation = facts(blob)[0]
  const conflicting = event(c.circleId, owner, 'CIRCLE_CREATED', creation.operationId,
    { ...creation.payload, name: 'another owner state' })
  const view = reduceCircle(c.circleId, [...facts(blob), conflicting])
  assert.equal(view.blocked, true)
  assert.equal(view.blockingConflicts.length, 1)
  assert.equal(view.ignoredActivityConflicts, 0)
  assert.deepEqual(view.members, [])
})

test('malformed activity payloads are skipped while envelope and membership integrity stay strict', async () => {
  const { blob, service, create, log } = setup()
  const c = await create()
  await log.append({ circleId: c.circleId, actorUserId: owner, type: 'PROGRESS_PUBLISHED',
    operationId: 'bad_progress_01', payload: { day: 'invalid', completed: true, newWords: -1 } })
  await log.append({ circleId: c.circleId, actorUserId: owner, type: 'ACHIEVEMENT_SHARED',
    operationId: 'bad_achievement_01', payload: { achievementId: '../private', selfReported: true } })
  const view = await service.getCircle(owner, c.circleId)
  assert.equal(view.members.length, 1)
  assert.equal(view.ignoredInvalidActivities, 2)
  assert.deepEqual(view.progress, [])
  assert.deepEqual(view.achievements, [])
  assert.deepEqual(reduceCircle(c.circleId, facts(blob)), reduceCircle(c.circleId, facts(blob).reverse()))
})

function transportSetup(options = {}) {
  const fixture = setup()
  const limiterCalls = []
  const transport = createCircleTransport({ service: fixture.service, rateLimit: async (context) => {
    limiterCalls.push(context)
    return options.limit ? options.limit(context) : true
  }, ...options.transportOptions })
  return { ...fixture, transport, limiterCalls }
}
async function api(transport, path, { token = owner, method = 'GET', body, rawBody, headers = {} } = {}) {
  const requestHeaders = { ...headers }
  if (token !== null) requestHeaders.Authorization = 'Bearer ' + token
  const content = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined
  if (content !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json'
  }
  const response = await transport.handle(new Request('https://offline.invalid/api/circle/v2' + path,
    { method, headers: requestHeaders, body: content }))
  return { response, status: response.status, data: await response.json() }
}
const createBody = { name: 'Light circle', operationId: 'api_create_0001', softMemberLimit: 2 }

test('transport requires complete service and trusted limiter; production gate stays closed', async () => {
  const { service } = setup()
  assert.throws(() => createCircleTransport({ service }), /limiter required/)
  assert.throws(() => createCircleTransport({ service: {}, rateLimit: async () => true }), /Complete/)
  const closed = createCircleHttpHandler({ service })
  await assert.rejects(closed.handle(new Request('https://offline.invalid/api/circle/v2')), { code: 'not_found' })
  assert.throws(() => createCircleHttpHandler({ service, enabled: true }), /gate is closed/)
})

test('transport offline create/join/progress/showcase/clap/read flow uses v2 IDs and pending writes', async () => {
  const { transport, limiterCalls } = transportSetup()
  const created = await api(transport, '', { method: 'POST', body: createBody })
  assert.equal(created.status, 202)
  assert.equal(created.data.result.status, 'pending')
  assert.equal(created.data.consistency, 'eventual')
  const { circleId, inviteCode } = created.data.result
  assert.match(circleId, /^[a-f0-9]{24}$/)
  const joined = await api(transport, '/join', { token: alice, method: 'POST', body: { inviteCode } })
  assert.equal(joined.status, 202)
  assert.equal(joined.data.result.admission, 'pending')
  await api(transport, '/' + circleId + '/progress/' + day,
    { token: alice, method: 'POST', body: { eventId: 'api_progress_01', completed: true, newWords: 8 } })
  const shared = await api(transport, '/' + circleId + '/showcase',
    { token: alice, method: 'POST', body: { achievementId: 'ACH_MASTERED_100' } })
  assert.equal(shared.status, 202)
  const clapped = await api(transport, '/' + circleId + '/claps',
    { method: 'POST', body: { memberUserId: alice, day } })
  assert.equal(clapped.status, 202)
  const progress = await api(transport, '/' + circleId + '/progress/' + day)
  assert.equal(progress.status, 200)
  assert.equal(progress.data.result[0].selfReported, true)
  const showcase = await api(transport, '/' + circleId + '/showcase/' + alice + '?ids=ACH_MASTERED_100')
  assert.equal(showcase.data.result[0].verified, false)
  const claps = await api(transport, '/' + circleId + '/claps/' + alice + '/' + day)
  assert.equal(claps.data.result.count, 1)
  const circle = await api(transport, '/' + circleId)
  assert.equal(circle.status, 200)
  assert.equal(circle.data.result.capacity.hardLimit, false)
  assert.equal(circle.response.headers.get('cache-control'), 'no-store')
  assert.equal(circle.response.headers.get('access-control-allow-origin'), null)
  assert.equal(circle.response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(limiterCalls.some((c) => c.action === 'getCircle' && c.circleId === circleId && c.token === owner))
})

test('transport retries same create/progress/clap logical commands without doubling soft counts', async () => {
  const { transport } = transportSetup()
  const one = await api(transport, '', { method: 'POST', body: createBody })
  const two = await api(transport, '', { method: 'POST', body: createBody })
  assert.equal(one.data.result.circleId, two.data.result.circleId)
  assert.equal(one.data.result.inviteCode, two.data.result.inviteCode)
  const { circleId, inviteCode } = one.data.result
  await api(transport, '/join', { token: alice, method: 'POST', body: { inviteCode } })
  for (let i = 0; i < 3; i++) {
    await api(transport, '/' + circleId + '/progress/' + day,
      { token: alice, method: 'POST', body: { eventId: 'api_progress_01', completed: true, newWords: 8 } })
    await api(transport, '/' + circleId + '/claps', { method: 'POST', body: { memberUserId: alice, day } })
  }
  const view = (await api(transport, '/' + circleId)).data.result
  assert.equal(view.progress.length, 1)
  assert.equal(view.progress[0].newWords, 8)
  assert.equal(view.claps.length, 1)
})

test('transport supports private leave/remove/close without exposing maintenance routes', async () => {
  const { transport } = transportSetup()
  const c = (await api(transport, '', { method: 'POST', body: createBody })).data.result
  await api(transport, '/join', { token: alice, method: 'POST', body: { inviteCode: c.inviteCode } })
  await api(transport, '/join', { token: bob, method: 'POST', body: { inviteCode: c.inviteCode } })
  assert.equal((await api(transport, '/' + c.circleId + '/remove',
    { token: bob, method: 'POST', body: { memberUserId: alice } })).status, 403)
  assert.equal((await api(transport, '/' + c.circleId + '/remove',
    { method: 'POST', body: { memberUserId: alice } })).status, 202)
  assert.equal((await api(transport, '/' + c.circleId, { token: alice })).status, 403)
  assert.equal((await api(transport, '/' + c.circleId + '/me', { token: bob, method: 'DELETE' })).status, 202)
  assert.equal((await api(transport, '/' + c.circleId + '/close', { method: 'POST' })).status, 202)
  assert.equal((await api(transport, '/' + c.circleId)).status, 403)
})

test('transport rejects missing token and nonmembers without private response details', async () => {
  const { transport, create } = transportSetup()
  const c = await create()
  const missing = await api(transport, '/' + c.circleId, { token: null })
  assert.equal(missing.status, 401)
  assert.deepEqual(missing.data, { ok: false, error: 'missing_token' })
  const forbidden = await api(transport, '/' + c.circleId, { token: 'visitor_000001' })
  assert.equal(forbidden.status, 403)
  assert.deepEqual(forbidden.data, { ok: false, error: 'not_circle_member' })
})

test('transport limiter is mandatory and denied or unknown limits never invoke mutations', async () => {
  for (const decision of [false, undefined, 'yes']) {
    const { blob, transport } = transportSetup({ limit: async () => decision })
    const result = await api(transport, '', { method: 'POST', body: createBody })
    assert.equal(result.status, 429)
    assert.equal(blob.writes.length, 0)
  }
})

test('transport rejects actor/role/verified/legacy capacity spoofing fields before service write', async () => {
  for (const extra of [{ actorUserId: alice }, { role: 'owner' }, { verified: true }, { maxMembers: 2 }]) {
    const { blob, transport } = transportSetup()
    const result = await api(transport, '', { method: 'POST', body: { ...createBody, ...extra } })
    assert.equal(result.status, 400)
    assert.equal(result.data.error, 'unexpected_field')
    assert.equal(blob.writes.length, 0)
  }
})

test('transport rejects non-JSON, arrays, null and malformed JSON', async () => {
  const { transport } = transportSetup()
  assert.equal((await api(transport, '', { method: 'POST', rawBody: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415)
  for (const rawBody of ['[]', 'null', '{', '']) {
    const result = await api(transport, '', { method: 'POST', rawBody })
    assert.equal(result.status, 400)
    assert.equal(result.data.error, 'invalid_json')
  }
})

test('transport limits UTF-8 bytes and validates declared body length', async () => {
  const { transport } = transportSetup()
  const large = await api(transport, '', { method: 'POST', rawBody: JSON.stringify({ name: '汉'.repeat(3000) }) })
  assert.equal(large.status, 413)
  assert.equal((await api(transport, '', { method: 'POST', rawBody: '{}', headers: { 'Content-Length': '9000' } })).status, 413)
  assert.equal((await api(transport, '', { method: 'POST', rawBody: '{}', headers: { 'Content-Length': '1' } })).status, 400)
  assert.equal((await api(transport, '', { method: 'POST', rawBody: '{}', headers: { 'Content-Length': '-1' } })).status, 400)
})

test('transport streamed oversized input is cancelled and invalid UTF-8 is rejected', async () => {
  const { transport, blob } = transportSetup()
  let cancelled = false
  let reads = 0
  const stream = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(6000)); },
    cancel() { cancelled = true },
  })
  const response = await transport.handle(new Request('https://offline.invalid/api/circle/v2',
    { method: 'POST', headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
      body: stream, duplex: 'half' }))
  assert.equal(response.status, 413)
  assert.equal(cancelled, true)
  assert.ok(reads <= 4)
  const invalid = await transport.handle(new Request('https://offline.invalid/api/circle/v2',
    { method: 'POST', headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
      body: new Uint8Array([255]) }))
  assert.equal(invalid.status, 400)
  assert.equal(blob.writes.length, 0)
})

test('transport rejects legacy IDs, escaped paths, unknown routes and maintenance endpoints', async () => {
  const { transport, create } = transportSetup()
  const c = await create()
  for (const path of ['/' + 'a'.repeat(12), '/' + c.circleId + '/recover',
    '/' + c.circleId + '/scrub', '/' + c.circleId + '/rotate-invite',
    '/' + c.circleId + '//close', '/%2e%2e/private', '/' + c.circleId + '/showcase/%2fprivate']) {
    assert.equal((await api(transport, path)).status, 404)
  }
  const legacy = await transport.handle(new Request('https://offline.invalid/api/circle/v1'))
  assert.equal(legacy.status, 404)
})

test('transport method/query validation denies unsupported or ambiguous request shapes', async () => {
  const { transport, create } = transportSetup()
  const c = await create()
  assert.equal((await api(transport, '')).status, 405)
  assert.equal((await api(transport, '/' + c.circleId + '/close', { method: 'GET' })).status, 405)
  assert.equal((await api(transport, '/' + c.circleId + '?admin=true')).status, 400)
  assert.equal((await api(transport, '/' + c.circleId + '/showcase/' + owner + '?ids=ACH_MASTERED_100&ids=ACH_MASTERED_100')).status, 400)
  assert.equal((await api(transport, '/' + c.circleId + '/showcase/' + owner + '?ids=../private')).status, 400)
})

test('transport returns typed domain errors but sanitizes messages, details and unexpected failures', async () => {
  const { service, create } = setup()
  const c = await create()
  const typed = createCircleTransport({ service: { ...service,
    getCircle: async () => { throw new AppError(401, 'session_revoked', 'private token detail', { secret: 'credential' }) } },
  rateLimit: async () => true })
  const rejected = await api(typed, '/' + c.circleId)
  assert.equal(rejected.status, 401)
  assert.deepEqual(rejected.data, { ok: false, error: 'session_revoked' })
  const broken = createCircleTransport({ service: { ...service,
    getCircle: async () => { throw Error('raw-storage-key-secret') } }, rateLimit: async () => true })
  const failure = await api(broken, '/' + c.circleId)
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.data, { ok: false, error: 'circle_internal_error' })
})

test('transport ambiguous append remains UNKNOWN and same operation retry converges', async () => {
  const { transport, blob } = transportSetup()
  blob.lostResponse = true
  const unknown = await api(transport, '', { method: 'POST', body: createBody })
  assert.equal(unknown.status, 503)
  assert.deepEqual(unknown.data, { ok: false, error: 'circle_append_unknown' })
  const retry = await api(transport, '', { method: 'POST', body: createBody })
  assert.equal(retry.status, 202)
  const read = await api(transport, '/' + retry.data.result.circleId)
  assert.equal(read.data.result.members.length, 1)
})

test('transport response budget fails without silently truncating a private view', async () => {
  const { service, create } = setup()
  const c = await create()
  const limited = createCircleTransport({ service: { ...service,
    getCircle: async () => ({ members: Array(100).fill({ userId: alice }) }) },
  rateLimit: async () => true, maxResponseBytes: 256 })
  const result = await api(limited, '/' + c.circleId)
  assert.equal(result.status, 503)
  assert.deepEqual(result.data, { ok: false, error: 'circle_response_too_large' })
})

test('transport denied limiter cancels unread streams without running a Circle command', async () => {
  const { transport, blob } = transportSetup({ limit: async () => false })
  let cancelled = false
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true },
  })
  const response = await transport.handle(new Request('https://offline.invalid/api/circle/v2',
    { method: 'POST', headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
      body: stream, duplex: 'half' }))
  assert.equal(response.status, 429)
  assert.equal(cancelled, true)
  assert.equal(blob.writes.length, 0)
})
