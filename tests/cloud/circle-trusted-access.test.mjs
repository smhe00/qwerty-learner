/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { createCircleTrustedAccessAdapter } from '../../cloud-functions/_shared/circle/trusted-access-adapter.js'
import { createCircleService } from '../../cloud-functions/_shared/circle/service.js'
import { createCircleEventLog } from '../../cloud-functions/_shared/circle/event-log.js'

const owner = 'owner_00000001'
const member = 'member_0000001'
const circleId = '1'.repeat(24)
const operationId = 'a'.repeat(64)
const commandHash = 'b'.repeat(64)

function fixture() {
  const sessions = new Map([
    ['owner_token', { user: { userId: owner }, session: { version: 1, expiresAt: 5000 } }],
    ['member_token', { user: { userId: member }, session: { version: 1, expiresAt: 5000 } }],
  ])
  const versions = new Map([[owner, 1], [member, 1]])
  const denied = new Set()
  const closed = new Set()
  const retired = new Map()
  const receipts = new Map()
  const calls = { me: [], checks: [], commits: [], lookups: [] }
  let failure = null
  const backend = {
    async me(token) {
      calls.me.push(token)
      if (failure === 'session_outage') throw Error('internal storage token detail')
      const session = sessions.get(token)
      if (!session) throw new AppError(401, 'session_revoked', 'Token invalid')
      return structuredClone(session)
    },
  }
  const authority = {
    async check(p) {
      calls.checks.push(structuredClone(p))
      if (failure === 'check_outage') throw Error('policy backend offline')
      return versions.get(p.actorUserId) === p.sessionVersion &&
        !closed.has(p.circleId) &&
        !denied.has(p.circleId + '/' + p.actorUserId) &&
        !retired.has(p.actorUserId) &&
        p.subjects.every((u) => !denied.has(p.circleId + '/' + u) && !retired.has(u))
    },
    async commitRevocation(p) {
      calls.commits.push(structuredClone(p))
      if (failure === 'revoke_outage') throw Error('policy backend offline')
      if (versions.get(p.actorUserId) !== p.sessionVersion) return false
      if (p.kind === 'circle') closed.add(p.circleId)
      else denied.add(p.circleId + '/' + p.targetUserId)
      const receipt = { status: 'committed', operationId: p.operationId, commandHash: p.commandHash }
      receipts.set(p.operationId, receipt)
      return receipt
    },
    async lookupRevocation(p) {
      calls.lookups.push(structuredClone(p))
      if (failure === 'lookup_outage') throw Error('policy backend offline')
      if (failure === 'lookup_invalid') return { status: 'committed',
        operationId: p.operationId, commandHash: 'f'.repeat(64) }
      return receipts.get(p.operationId) ?? null
    },
    async authorizeMaintenance(p) {
      if (failure === 'maintenance_outage') throw Error('policy backend offline')
      return p.circleId === circleId && failure !== 'maintenance_deny'
    },
    async lookupRetirement({ userId }) {
      if (failure === 'retirement_outage') throw Error('policy backend offline')
      return retired.get(userId) ?? null
    },
  }
  const bridge = createCircleTrustedAccessAdapter({
    backend, authority, nowSeconds: () => 1000,
  })
  return { sessions, versions, denied, closed, receipts, retired, calls,
    backend, authority, bridge, fail: (mode) => { failure = mode } }
}

test('bridge refuses missing independent authority or backend session verifier', () => {
  const f = fixture()
  assert.throws(() => createCircleTrustedAccessAdapter({ backend: f.backend }),
    /independent Circle authority/)
  assert.throws(() => createCircleTrustedAccessAdapter({ authority: f.authority }),
    /Current-session backend/)
  assert.throws(() => createCircleTrustedAccessAdapter({
    backend: f.backend, authority: { ...f.authority, commitRevocation: null },
  }), /independent Circle authority/)
})

test('real me-shaped session is validated freshly; expiration and revocation remain typed', async () => {
  const f = fixture()
  assert.deepEqual(await f.bridge.authenticate('owner_token'),
    { userId: owner, sessionVersion: 1, expiresAt: 5000 })
  f.sessions.get('owner_token').session.expiresAt = 1000
  await assert.rejects(f.bridge.authenticate('owner_token'), { code: 'session_expired' })
  f.sessions.get('owner_token').session.expiresAt = 5000
  await assert.rejects(f.bridge.authenticate('revoked_token'), { code: 'session_revoked' })
  f.fail('session_outage')
  await assert.rejects(f.bridge.authenticate('owner_token'), { code: 'circle_session_unavailable' })
  f.fail(null)
  f.sessions.get('owner_token').session.version = 0
  await assert.rejects(f.bridge.authenticate('owner_token'), { code: 'circle_session_uncertain' })
})

test('no raw bearer token passes to authority and each policy check re-authenticates', async () => {
  const f = fixture()
  const query = { token: 'owner_token', actorUserId: owner, circleId,
    action: 'read', phase: 'before', subjects: [member, owner, member] }
  assert.equal(await f.bridge.trustedAccess.check(query), true)
  assert.deepEqual(f.calls.checks[0].subjects, [member, owner])
  assert.equal(JSON.stringify(f.calls.checks[0]).includes('owner_token'), false)
  assert.equal(await f.bridge.trustedAccess.check({ ...query, phase: 'before_return' }), true)
  assert.equal(f.calls.me.length, 2)
  f.versions.set(owner, 2)
  assert.equal(await f.bridge.trustedAccess.check(query), false, 'Authority must reject stale session')
  f.versions.set(owner, 1)
  f.fail('check_outage')
  assert.equal(await f.bridge.trustedAccess.check(query), false)
  f.fail(null)
  assert.equal(await f.bridge.trustedAccess.check({ ...query, actorUserId: member }), false)
  assert.equal(await f.bridge.trustedAccess.check({ ...query, subjects: ['../private'] }), false)
})

test('pre-scan guards with no member list require authority and do not assume membership', async () => {
  const f = fixture()
  assert.equal(await f.bridge.trustedAccess.check({ token: 'owner_token', actorUserId: owner,
    circleId, action: 'read', phase: 'before' }), true)
  assert.deepEqual(f.calls.checks.at(-1).subjects, [])
  f.denied.add(circleId + '/' + owner)
  assert.equal(await f.bridge.trustedAccess.check({ token: 'owner_token', actorUserId: owner,
    circleId, action: 'read', phase: 'before' }), false)
})

test('revocation is committed only with exact bound durable receipt, not boolean acceptance', async () => {
  const f = fixture()
  const command = { circleId, actorUserId: owner, type: 'MEMBER_REMOVED',
    operationId: 'remove_00001', payload: { targetUserId: member } }
  const args = { token: 'owner_token', actorUserId: owner, circleId,
    kind: 'member', targetUserId: member, command, operationId, commandHash }
  assert.equal(await f.bridge.trustedAccess.revoke(args), true)
  assert.equal(f.denied.has(circleId + '/' + member), true)
  assert.equal(JSON.stringify(f.calls.commits[0]).includes('owner_token'), false)
  assert.deepEqual(await f.bridge.trustedAccess.lookupRevocation({ operationId, commandHash }),
    { status: 'committed', operationId, commandHash })
  assert.equal(await f.bridge.trustedAccess.revoke({ ...args, actorUserId: member }), false)
  f.fail('revoke_outage')
  assert.equal(await f.bridge.trustedAccess.revoke(args), false)
})

test('receipt lookup differentiates absent, outage and forged mismatched receipt', async () => {
  const f = fixture()
  assert.equal(await f.bridge.trustedAccess.lookupRevocation({ operationId, commandHash }), null)
  f.fail('lookup_outage')
  await assert.rejects(f.bridge.trustedAccess.lookupRevocation({ operationId, commandHash }),
    { code: 'circle_revocation_receipt_unavailable' })
  f.fail('lookup_invalid')
  await assert.rejects(f.bridge.trustedAccess.lookupRevocation({ operationId, commandHash }),
    { code: 'circle_revocation_receipt_invalid' })
  f.fail(null)
  await assert.rejects(f.bridge.trustedAccess.lookupRevocation({
    operationId: 'bad', commandHash,
  }), { code: 'circle_revocation_receipt_invalid' })
})

test('retirement and maintenance gates never turn provider outages into approvals', async () => {
  const f = fixture()
  const params = { action: 'scrub_circle_retired_account', circleId, userId: member }
  assert.equal(await f.bridge.trustedAccess.authorizeMaintenance(params), true)
  f.fail('maintenance_outage')
  assert.equal(await f.bridge.trustedAccess.authorizeMaintenance(params), false)
  f.fail('maintenance_deny')
  assert.equal(await f.bridge.trustedAccess.authorizeMaintenance(params), false)
  f.fail(null)
  assert.equal(await f.bridge.trustedAccess.lookupRetirement({ userId: member }), null)
  f.retired.set(member, { userId: member, status: 'retired', fenceId: 'fence_00000001' })
  assert.deepEqual(await f.bridge.trustedAccess.lookupRetirement({ userId: member }),
    { userId: member, status: 'retired', fenceId: 'fence_00000001' })
  f.retired.set(member, { userId: owner, status: 'retired', fenceId: 'fence_00000001' })
  await assert.rejects(f.bridge.trustedAccess.lookupRetirement({ userId: member }),
    { code: 'circle_retirement_uncertain' })
  f.fail('retirement_outage')
  await assert.rejects(f.bridge.trustedAccess.lookupRetirement({ userId: member }),
    { code: 'circle_retirement_unavailable' })
})

test('Circle kernel with bridged V4 sessions fails private reads closed on independent fences', async () => {
  const f = fixture()
  const objects = new Map()
  const blob = {
    async setJSON(key, data, options) {
      assert.equal(options, undefined)
      objects.set(key, structuredClone(data))
    },
    async list({ prefix }) {
      return { blobs: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }
    },
    async get(key) { return structuredClone(objects.get(key) ?? null) },
  }
  const service = createCircleService({
    log: createCircleEventLog(blob), authenticate: f.bridge.authenticate,
    trustedAccess: f.bridge.trustedAccess, inviteKey: 'test-only-server-invite-secret-00000001',
  })
  const c = await service.createCircle('owner_token',
    { name: 'Bridge test', operationId: 'bridge_create_0001' })
  await service.joinCircle('member_token', c.inviteCode)
  assert.equal((await service.getCircle('owner_token', c.circleId)).members.length, 2)
  assert.equal((await service.getCircle('member_token', c.circleId)).members.length, 2)
  f.denied.add(c.circleId + '/' + member)
  await assert.rejects(service.getCircle('member_token', c.circleId),
    { code: 'circle_access_uncertain' })
  await assert.rejects(service.getCircle('owner_token', c.circleId),
    { code: 'circle_access_uncertain' })
  f.denied.delete(c.circleId + '/' + member)
  f.versions.set(owner, 2)
  await assert.rejects(service.getCircle('owner_token', c.circleId),
    { code: 'circle_access_uncertain' })
})
