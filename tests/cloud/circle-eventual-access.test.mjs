/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { createCircleEventualService, createCircleService } from '../../cloud-functions/_shared/circle/service.js'
import { createCircleEventLog } from '../../cloud-functions/_shared/circle/event-log.js'
import { createCircleEventualAssembly } from '../../cloud-functions/_shared/circle/assembly.js'
import { reduceCircle } from '../../cloud-functions/_shared/circle/reducer.js'

const owner = 'owner_00000001'
const alice = 'alice_00000001'
const bob = 'bob_000000001'
const another = 'visitor_000001'
const day = '2026-10-14'
const key = 'test-only-long-invite-key-for-circle-eventual-mode'
class EventualBlob {
  objects = new Map()
  hidden = new Set()
  writes = []
  loseNext = false
  async setJSON(path, event, options) {
    assert.equal(options, undefined, 'CAS must never be sent to EdgeOne Blob')
    assert.match(path, /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/)
    this.objects.set(path, structuredClone(event))
    this.writes.push(path)
    if (this.loseNext) { this.loseNext = false; throw Error('lost response') }
  }
  async get(path) { return structuredClone(this.objects.get(path) ?? null) }
  async list({ prefix }) {
    return { blobs: [...this.objects.keys()].filter(
      (path) => path.startsWith(prefix) && !this.hidden.has(path)).map((key) => ({ key })) }
  }
}
function setup() {
  const blob = new EventualBlob()
  const sessions = new Map([[owner, owner], [alice, alice], [bob, bob], [another, another]])
  let reads = 0
  const backend = {
    async me(token) {
      reads++
      const userId = sessions.get(token)
      if (!userId) throw new AppError(401, 'session_revoked', 'Logged out')
      return { user: { userId }, session: { version: 1, expiresAt: 9999999999 } }
    },
  }
  const log = createCircleEventLog(blob)
  const service = createCircleEventualService({ log, authenticate: (t) => backend.me(t), inviteKey: key })
  const create = () => service.createCircle(owner, { name: 'Light Social', operationId: 'create_00001' })
  return { blob, log, service, sessions, backend, create, getReads: () => reads }
}
function hideEvent(blob, type) {
  const [key] = [...blob.objects].filter(([, e]) => e.type === type).map(([k]) => k).slice(-1)
  assert.ok(key, 'Event exists')
  blob.hidden.add(key)
  return key
}
test('eventual factory rejects invalid configuration and forbids ambiguous mixed policy', () => {
  const s = setup()
  assert.throws(() => createCircleEventualService({ log: s.log, authenticate: async () => {} }),
    /invite key/)
  assert.throws(() => createCircleService({
    log: s.log, authenticate: (t) => s.backend.me(t), inviteKey: key, accessModel: 'unknown',
  }), /Unknown Circle access model/)
  assert.throws(() => createCircleService({
    log: s.log, authenticate: (t) => s.backend.me(t), inviteKey: key,
    accessModel: 'eventual', trustedAccess: { check: async () => true },
  }), /must not silently mix/)
})
test('create/join/progress/achievement/clap work without a strong revocation service', async () => {
  const { service, create, getReads, blob } = setup()
  const c = await create()
  const join = await service.joinCircle(alice, c.inviteCode)
  assert.equal(join.final, false)
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 20, eventId: 'progress_0001' })
  await service.shareAchievement(alice, c.circleId, 'ACH_STREAK_10')
  await service.reactProgress(owner, c.circleId, alice, day)
  const view = await service.getCircle(owner, c.circleId)
  assert.deepEqual(view.members.map((m) => m.userId), [owner, alice])
  assert.equal(view.progress[0].newWords, 20)
  assert.equal(view.achievements[0].verified, false)
  assert.equal(view.claps.length, 1)
  assert.ok(getReads() > 10, 'current V4 session must be checked at operation boundaries')
  assert.equal(new Set(blob.writes).size, blob.writes.length)
})
test('removed member can see a stale view briefly but eventually disappears, remove-wins', async () => {
  const { service, create, blob } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const removed = await service.removeMember(owner, c.circleId, alice)
  assert.equal(removed.status, 'pending')
  assert.equal(removed.consistency, 'eventual')
  assert.equal(removed.final, false)
  const key = hideEvent(blob, 'MEMBER_REMOVED')
  const stale = await service.getCircle(alice, c.circleId)
  assert.equal(stale.members.length, 2, 'Expected accepted propagation delay, not immediate fencing')
  await service.publishProgress(alice, c.circleId, day,
    { completed: true, newWords: 10, eventId: 'progress_0001' })
  blob.hidden.delete(key)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'not_circle_member' })
  const current = await service.getCircle(owner, c.circleId)
  assert.equal(current.revokedCount, 1)
  assert.equal(current.members.length, 1)
  assert.equal(current.progress.length, 0, 'Late stale-authorization posts are filtered after convergence')
  await assert.rejects(service.joinCircle(alice, c.inviteCode), { code: 'membership_revoked' })
})
test('leave and circle closure use event-only pending results, and close-wins after convergence', async () => {
  const { service, create, blob } = setup()
  const c = await create()
  await service.joinCircle(alice, c.inviteCode)
  const left = await service.leaveCircle(alice, c.circleId)
  assert.equal(left.final, false)
  assert.equal(left.status, 'pending')
  assert.equal((await service.getCircle(owner, c.circleId)).members.length, 1)
  const closed = await service.closeCircle(owner, c.circleId)
  assert.equal(closed.consistency, 'eventual')
  assert.equal(closed.final, false)
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_closed' })
  const hiddenClose = hideEvent(blob, 'CIRCLE_CLOSED')
  const stale = await service.getCircle(owner, c.circleId)
  assert.equal(stale.closed, false, 'Close may be temporarily invisible')
  blob.hidden.delete(hiddenClose)
  await assert.rejects(service.getCircle(owner, c.circleId), { code: 'circle_closed' })
})
test('server identity, invitations and owner permissions stay required', async () => {
  const { service, sessions, create } = setup()
  const c = await create()
  await assert.rejects(service.getCircle(bob, c.circleId), { code: 'not_circle_member' })
  await assert.rejects(service.removeMember(bob, c.circleId, owner), { code: 'not_circle_owner' })
  await assert.rejects(service.joinCircle(bob, c.inviteCode.slice(0, -1) + 'x'), { code: 'invalid_invite' })
  await service.joinCircle(alice, c.inviteCode)
  await assert.rejects(service.removeMember(alice, c.circleId, owner), { code: 'not_circle_owner' })
  await assert.rejects(service.leaveCircle(owner, c.circleId), { code: 'owner_cannot_leave' })
  sessions.delete(alice)
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'session_revoked' })
})
test('pending join visibility and retries never require a CAS or leader election', async () => {
  const { service, create, blob } = setup()
  const c = await create()
  blob.loseNext = true
  await assert.rejects(service.joinCircle(alice, c.inviteCode), { code: 'circle_append_unknown' })
  await service.joinCircle(alice, c.inviteCode)
  const hidden = [...blob.objects].filter(([, e]) => e.type === 'JOIN_REQUESTED')
  hidden.forEach(([key]) => blob.hidden.add(key))
  await assert.rejects(service.getCircle(alice, c.circleId), { code: 'not_circle_member' })
  hidden.forEach(([key]) => blob.hidden.delete(key))
  const v = await service.getCircle(owner, c.circleId)
  assert.equal(v.members.length, 2)
  assert.equal(reduceCircle(c.circleId, [...blob.objects.values()]).members.length, 2)
  assert.equal(new Set(blob.writes).size, blob.writes.length)
})
test('dozens of peer joins converge under soft-only capacity', async () => {
  const { create, blob } = setup()
  const c = await create()
  const peers = Array.from({ length: 35 }, (_, i) => 'student_' + String(i).padStart(5, '0'))
  // Existing sessions fixture only has four accounts. A separate authenticated
  // callback models newly issued V4 accounts without introducing fake CAS.
  const many = createCircleEventualService({
    log: createCircleEventLog(blob), inviteKey: key,
    authenticate: async (t) => ({ user: { userId: t } }),
  })
  await Promise.all(peers.map((p) => many.joinCircle(p, c.inviteCode)))
  const view = await many.getCircle(owner, c.circleId)
  assert.equal(view.members.length, 36)
  assert.equal(view.capacity.hardLimit, false)
  assert.equal(view.capacity.aboveSoftLimit, true)
})
test('assembly reuses V4 login and requires limiter; API remains offline', async () => {
  const s = setup()
  assert.throws(() => createCircleEventualAssembly({
    backend: s.backend, blobStore: s.blob, inviteKey: key,
  }), /gateway limiter/)
  const allowed = createCircleEventualAssembly({
    backend: s.backend, blobStore: s.blob, inviteKey: key,
    limit: async ({ token, request }) => token === owner && request.method === 'POST',
  })
  const response = await allowed.transport.handle(new Request('https://offline.invalid/api/circle/v2', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Offline Circle', operationId: 'offline_create_001' }),
  }))
  assert.equal(response.status, 202)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.consistency, 'eventual')
  assert.equal(payload.result.status, 'pending')
  const denied = await allowed.transport.handle(new Request('https://offline.invalid/api/circle/v2', {
    method: 'POST', headers: { Authorization: 'Bearer ' + alice,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Denied', operationId: 'offline_create_002' }),
  }))
  assert.equal(denied.status, 429)
  assert.equal(s.blob.objects.size, 1)
})
