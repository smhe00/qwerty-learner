/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createGuardedBackendService } from '../../cloud-functions/_shared/session-handoff-service.js'
import { createSessionHandoffBarrier } from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { AtomicTestStore, deferred } from './session-handoff-test-store.mjs'
import { PausableBlob, fixture, harness } from './session-handoff-fixtures.mjs'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const code = value => error => error.code === value
const state = coordinator => [...coordinator.states.values()][0]
const deadline = { timeout: 8000 }

test('integrated service: B login drains A and no external wrapping is required', deadline, async () => {
  const h = await harness()
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  let returned = false
  const login = h.b.login(h.username, h.password, 'device-B').then(value => { returned = true; return value })
  try {
    await h.coordinator.when(s => Boolean(s.pending))
    assert.equal(returned, false)
    await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'more')),
      code('handoff_draining'))
  } finally { pause.release.resolve() }
  const [uploaded, second] = await Promise.all([writing, login])
  assert.equal(uploaded.revision, 1)
  assert.equal((await h.b.syncMeta(second.token)).revision, 1)
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'late', 1)),
    code('session_revoked'))
  assert.equal((await h.b.putSyncV4Binary(second.token, fixture(h.first.user.userId, 'beta', 1))).revision, 2)
})

test('wrong login password neither closes admission nor changes barrier state', deadline, async () => {
  const h = await harness()
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const before = structuredClone(state(h.coordinator))
  try {
    await assert.rejects(h.b.login(h.username, 'wrong-password', 'B'), code('incorrect_password'))
    assert.deepEqual(state(h.coordinator), before)
  } finally { pause.release.resolve() }
  await writing
})

test('invalid bearer is rejected before any coordinator acquisition', deadline, async () => {
  const h = await harness()
  await assert.rejects(h.a.putSyncV4Binary('invalid', {}), code('invalid_token'))
  assert.equal(h.coordinator.states.size, 0)
})

test('same-device overlapping writes are serialized/refused, not implicitly trusted', deadline, async () => {
  const h = await harness()
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  try {
    await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'beta')),
      code('handoff_busy'))
  } finally { pause.release.resolve() }
  await writing
})

test('invalid payload releases a pre-mutation rejection and does not touch activity', deadline, async () => {
  let touches = 0
  const h = await harness({ options: { activityGuard: async () => { touches++ } } })
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, {}), code('invalid_base_revision'))
  assert.equal(touches, 0)
  assert.equal(state(h.coordinator).active, null)
  assert.equal(state(h.coordinator).blocked, null)
  await h.b.login(h.username, h.password, 'B')
  assert.equal(touches, 1)
})

test('visible revision conflict is a safe rejection, not a permanently poisoned account', deadline, async () => {
  const h = await harness()
  await h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'beta')),
    code('sync_conflict'))
  assert.equal(state(h.coordinator).blocked, null)
  await h.b.login(h.username, h.password, 'B')
})

test('incorrect password for change/delete cannot poison the barrier through idle.touch', deadline, async () => {
  let touches = 0
  const h = await harness({ options: { activityGuard: async () => { touches++ } } })
  await assert.rejects(h.a.changePassword(h.first.token, 'wrong', 'new-password', 'A'), code('invalid_credentials'))
  await assert.rejects(h.a.deleteAccount(h.first.token, 'wrong'), code('invalid_credentials'))
  assert.equal(touches, 0)
  assert.equal(state(h.coordinator).blocked, null)
  await h.b.login(h.username, h.password, 'B')
})

test('deferred activity write is awaited before B can take over', deadline, async () => {
  const hold = deferred(), reached = deferred()
  let touches = 0
  const h = await harness({ options: { activityGuard: async () => {
    if (++touches === 1) { reached.resolve(); await hold.promise }
  } } })
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await reached.promise
  let returned = false
  const login = h.b.login(h.username, h.password, 'B').then(value => { returned = true; return value })
  try {
    await h.coordinator.when(s => Boolean(s.pending))
    assert.equal(returned, false)
  } finally { hold.resolve() }
  await Promise.all([writing, login])
})

test('token valid at preflight but revoked before acquisition is rechecked inside barrier', deadline, async () => {
  let hook = null
  const h = await harness({ gateDecorator: gate => ({ async execute(...args) {
    if (args[1] === 'writer' && hook) { const action = hook; hook = null; await action() }
    return gate.execute(...args)
  } }) })
  hook = () => h.b.login(h.username, h.password, 'B')
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')),
    code('session_revoked'))
  assert.equal(state(h.coordinator).active, null)
  assert.equal(state(h.coordinator).blocked, null)
  assert.equal(await h.storage.getLatestRevisionMeta(h.first.user.userId), null)
})

test('all public backend methods are classified and preflight helpers are not exposed', deadline, async () => {
  const h = await harness()
  assert.deepEqual(Object.keys(h.a).sort(), Object.keys(h.plain).sort())
  assert.equal(h.a.preflightLogin, undefined)
  assert.equal(h.a.preflightToken, undefined)
  assert.equal(Object.isFrozen(h.a), true)
})

test('swallowed retention write error is not silently converted to a safe release', deadline, async () => {
  const h = await harness({ storageDecorator: storage => ({ ...storage,
    async pruneRevisions() { throw new Error('ambiguous cleanup') },
  }) })
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')),
    code('handoff_operation_outcome_unknown'))
  assert.equal(state(h.coordinator).blocked.reason, 'operation-outcome-unknown')
  await assert.rejects(h.b.login(h.username, h.password, 'B'), code('handoff_blocked'))
})

test('response lost after manifest publication prevents takeover despite readable revision', deadline, async () => {
  const h = await harness({ storageDecorator: storage => ({ ...storage,
    async createRevision(...args) { await storage.createRevision(...args); throw new Error('response lost') },
  }) })
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')), /response lost/)
  assert.equal((await h.storage.getLatestRevisionMeta(h.first.user.userId)).revision, 1)
  await assert.rejects(h.b.login(h.username, h.password, 'B'), code('handoff_blocked'))
})

test('read failure before writes can release safely, preserving subsequent login', deadline, async () => {
  const h = await harness({ storageDecorator: storage => ({ ...storage,
    async getLatestRevisionMeta() { throw new Error('read unavailable') },
  }) })
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')),
    code('snapshot_metadata_read_failed'))
  assert.equal(state(h.coordinator).blocked, null)
  await h.b.login(h.username, h.password, 'B')
})

test('C cannot jump an already pending B handoff', deadline, async () => {
  const h = await harness()
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const b = h.b.login(h.username, h.password, 'B')
  try {
    await h.coordinator.when(s => Boolean(s.pending))
    await assert.rejects(h.make().login(h.username, h.password, 'C'), code('handoff_busy'))
  } finally { pause.release.resolve() }
  await Promise.all([writing, b])
})

test('registration and login use one normalized account namespace', deadline, async () => {
  const coordinator = new AtomicTestStore()
  const storage = createEdgeOneBlobStorage(new PausableBlob())
  const service = createBackendService({ storage, handoffBarrier: createSessionHandoffBarrier({
    store: coordinator, namespace: 'register-integration', pollMs: 1,
  }) })
  await service.register(' New-User ', 'test-only-password', 'A')
  await service.login('NEW-USER', 'test-only-password', 'B')
  assert.equal(coordinator.states.size, 1)
})

test('duplicate registration is rejected before touching a current user barrier', deadline, async () => {
  const h = await harness()
  await assert.rejects(h.b.register(h.username, h.password, 'B'), code('username_taken'))
  assert.equal(h.coordinator.states.size, 0)
})

test('unauthenticated cleanup helper is refused in coordinated mode', deadline, async () => {
  const h = await harness()
  await assert.rejects(h.a.cleanupTestUser(h.username), code('handoff_unguarded_cleanup_disabled'))
  assert.ok(await h.storage.getAccount(h.accountHash))
})

test('invalid or null barrier never silently falls back to unguarded service', () => {
  const storage = createEdgeOneBlobStorage(new PausableBlob())
  for (const handoffBarrier of [null, undefined, {}, { execute: 1 }]) {
    assert.throws(() => createBackendService({ storage, handoffBarrier }), code('handoff_atomic_store_required'))
  }
})

test('new unclassified API methods fail construction rather than bypassing protection', () => {
  assert.throws(() => createGuardedBackendService(() => ({ newAuthorityMutation() {} }),
    { storage: {} }, { execute() {} }), code('handoff_unclassified_service_method'))
})

test('coordinated backend refuses independent multi-session mode', () => {
  assert.throws(() => createBackendService({ storage: {}, multiSessionEnabled: true,
    handoffBarrier: { execute() {} } }), code('handoff_requires_single_session'))
})

test('password rotation is guarded and old token cannot mutate afterwards', deadline, async () => {
  const h = await harness()
  const next = await h.a.changePassword(h.first.token, h.password, 'replacement-only-password', 'B')
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')),
    code('session_revoked'))
  assert.equal((await h.b.putSyncV4Binary(next.token, fixture(h.first.user.userId, 'beta'))).revision, 1)
})

test('admission timeout cannot claim B login or release A still running', deadline, async () => {
  const h = await harness({ gateOptions: { admissionTimeoutMs: 0 } })
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  try {
    await assert.rejects(h.b.login(h.username, h.password, 'B'), code('handoff_timeout'))
    assert.equal(state(h.coordinator).active.kind, 'writer')
    assert.equal(state(h.coordinator).pending, null)
    assert.equal((await h.a.me(h.first.token)).user.userId, h.first.user.userId)
    assert.equal(await h.storage.getLatestRevisionMeta(h.first.user.userId), null)
  } finally { pause.release.resolve() }
  await writing
  const second = await h.b.login(h.username, h.password, 'B')
  assert.equal((await h.b.syncMeta(second.token)).revision, 1)
  await assert.rejects(h.a.me(h.first.token), code('session_revoked'))
})

test('session reads with activity writes participate in the drain barrier', deadline, async () => {
  let touches = 0
  const h = await harness({ options: { activityGuard: async () => { touches++ } } })
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const login = h.b.login(h.username, h.password, 'B')
  try {
    await h.coordinator.when(s => Boolean(s.pending))
    const before = structuredClone(state(h.coordinator))
    await assert.rejects(h.a.me(h.first.token), code('handoff_draining'))
    await assert.rejects(h.a.syncMeta(h.first.token), code('handoff_draining'))
    assert.equal(touches, 0)
    assert.deepEqual(state(h.coordinator).active, before.active)
    assert.deepEqual(state(h.coordinator).pending, before.pending)
  } finally { pause.release.resolve() }
  const [, second] = await Promise.all([writing, login])
  assert.equal(touches, 2) // Only the completed write and new login.
  await h.b.me(second.token)
  await h.b.syncMeta(second.token)
  assert.equal(touches, 4) // Legitimate read activity is not silently dropped.
})

test('all learning mutation entry points reject new work while B drains A', deadline, async () => {
  const h = await harness()
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const login = h.b.login(h.username, h.password, 'B')
  const mutations = ['publishLearningBatch', 'publishChainedLearningBatch', 'issueChainedCheckout',
    'putSync', 'putSyncV4', 'putSyncV4Recovery', 'putSyncV4Binary',
    'putSyncV4BinaryRecovery', 'migrateSyncV4Binary']
  try {
    await h.coordinator.when(s => Boolean(s.pending))
    const before = structuredClone([...h.blob.data])
    for (const name of mutations) {
      await assert.rejects(h.a[name](h.first.token, {}), code('handoff_draining'), name)
    }
    assert.deepEqual(structuredClone([...h.blob.data]), before)
  } finally { pause.release.resolve() }
  await Promise.all([writing, login])
})

test('a different account can proceed without waiting for this account to drain', deadline, async () => {
  const coordinator = new AtomicTestStore()
  const h = await harness({ coordinator })
  const other = await harness({ coordinator })
  const pause = h.blob.armManifestPause()
  const writing = h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const login = h.b.login(h.username, h.password, 'B')
  try {
    await coordinator.when(s => Boolean(s.pending))
    const second = await other.b.login(other.username, other.password, 'other-B')
    assert.equal(second.user.userId, other.first.user.userId)
    assert.equal((await other.b.putSyncV4Binary(second.token,
      fixture(other.first.user.userId, 'other-account'))).revision, 1)
    assert.equal(await h.storage.getLatestRevisionMeta(h.first.user.userId), null)
  } finally { pause.release.resolve() }
  await Promise.all([writing, login])
})

test('old event and recovery calls cannot mutate storage after B receives login success', deadline, async () => {
  const h = await harness({ options: { eventPilotEnabled: true } })
  const second = await h.b.login(h.username, h.password, 'B')
  assert.ok(second.token)
  const before = structuredClone([...h.blob.data])
  for (const name of ['publishLearningBatch', 'publishChainedLearningBatch', 'issueChainedCheckout',
    'putSync', 'putSyncV4', 'putSyncV4Recovery', 'putSyncV4Binary',
    'putSyncV4BinaryRecovery', 'migrateSyncV4Binary', 'deleteAccount', 'changePassword']) {
    await assert.rejects(h.a[name](h.first.token, {}), code('session_revoked'), name)
  }
  assert.deepEqual(structuredClone([...h.blob.data]), before)
})

test('failure in final activity write cannot advertise a completed handoff', deadline, async () => {
  const h = await harness({ options: { activityGuard: async () => { throw Error('activity response unknown') } } })
  await assert.rejects(h.a.putSyncV4Binary(h.first.token, fixture(h.first.user.userId, 'alpha')),
    /activity response unknown/)
  assert.equal((await h.storage.getLatestRevisionMeta(h.first.user.userId)).revision, 1)
  await assert.rejects(h.b.login(h.username, h.password, 'B'), code('handoff_blocked'))
})
