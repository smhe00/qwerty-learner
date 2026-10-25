/* eslint-env node */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { DAY_MS, IDLE_ACTIVATION_KEY, createIdleAccounts } from '../../cloud-functions/_shared/idle-accounts.js'
import { idleDeploymentOptions } from '../../cloud-functions/_shared/idle-deployment-policy.js'

function fixture() {
  const objects = new Map()
  const calls = []
  let now = Date.parse('2026-10-25T12:00:00Z')
  const store = {
    async get(key) { calls.push(['get', key]); return structuredClone(objects.get(key) ?? null) },
    async setJSON(key, value, options) {
      calls.push(['set', key])
      if (options?.onlyIfNew && objects.has(key)) throw Error('already exists')
      objects.set(key, structuredClone(value))
    },
    async list({ prefix }) {
      calls.push(['list', prefix])
      return { blobs: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
    },
    async delete(key) { calls.push(['delete', key]); objects.delete(key) },
  }
  function account(name = 'old-learner', userId = 'b'.repeat(32)) {
    const usernameHash = createHash('sha256').update(name).digest('hex')
    const identity = { userId, usernameHash, username: name, normalizedUsername: name,
      status: 'active', createdAt: new Date(now - 500 * DAY_MS).toISOString() }
    objects.set(`accounts/${usernameHash}/identity.json`, identity)
    objects.set(`users/${userId}/payload.json`, { synthetic: true })
    return identity
  }
  const idle = (env = {}, policy) => createIdleAccounts({ store, clock: () => now, ...idleDeploymentOptions(env, policy) })
  return { store, objects, calls, account, idle, now: () => now, advance: ms => { now += ms } }
}

test('code deployment enables maintenance with no console variables or API credential', async () => {
  const f = fixture()
  const identity = f.account()
  const idle = f.idle()
  assert.equal(idle.executionEnabled, true)
  await idle.touch(identity)
  assert.equal(f.calls.some(([, key]) => key === IDLE_ACTIVATION_KEY), false,
    'Login/activity must not wait for project activation reads or writes')
  assert.equal((await idle.runDaily()).status, 'complete')
  assert.equal(f.objects.get(IDLE_ACTIVATION_KEY).startedAt, new Date(f.now()).toISOString())
  assert.equal((await idle.runDaily()).status, 'already_ran')
  assert.ok(f.objects.has(`accounts/${identity.usernameHash}/identity.json`))
  assert.ok(!f.calls.some(([op]) => op === 'delete'))
})

test('first deployed maintenance protects old accounts for180 days and survives new process/deployment', async () => {
  const f = fixture()
  const identity = f.account()
  const activatedAt = f.now()
  await f.idle().runDaily()
  f.advance(179 * DAY_MS)
  const policy = await f.idle().inspect(identity)
  assert.equal(policy.eligible, false)
  assert.equal(Date.parse(policy.expiresAt), activatedAt + 180 * DAY_MS)
  f.advance(DAY_MS)
  assert.equal((await f.idle().inspect(identity)).eligible, true)
  const first = await f.idle().run({ dryRun: false })
  assert.equal(first.results[0].action, 'draining')
  f.advance(DAY_MS)
  assert.equal((await f.idle().run({ dryRun: false })).results[0].action, 'deleted')
  assert.equal(f.objects.has(`accounts/${identity.usernameHash}/identity.json`), false)
  assert.equal(Date.parse(f.objects.get(IDLE_ACTIVATION_KEY).startedAt), activatedAt)
  assert.equal(f.calls.filter(([op, key]) => op === 'set' && key === IDLE_ACTIVATION_KEY).length, 1)
})

test('administrator preview is read-only and cannot start or backdate the retention clock', async () => {
  const f = fixture()
  const identity = f.account()
  const previewAt = f.now()
  assert.equal((await f.idle().run()).results[0].action, 'retain')
  assert.equal(f.calls.some(([op]) => op === 'set' || op === 'delete'), false)
  assert.equal(f.objects.has(IDLE_ACTIVATION_KEY), false)
  f.advance(20 * DAY_MS)
  await f.idle().runDaily()
  assert.equal(Date.parse(f.objects.get(IDLE_ACTIVATION_KEY).startedAt), previewAt + 20 * DAY_MS)
  assert.equal((await f.idle().inspect(identity)).eligible, false)
})

test('failed activation cannot fence/delete accounts; a later attempt starts a fresh full floor', async () => {
  const f = fixture()
  const identity = f.account()
  const original = f.store.setJSON
  f.store.setJSON = async (key, ...args) => {
    if (key === IDLE_ACTIVATION_KEY) throw Error('synthetic provider failure')
    return original(key, ...args)
  }
  assert.equal((await f.idle().runDaily()).status, 'interrupted')
  assert.equal(f.calls.some(([op, key]) => op === 'delete' || (op === 'set' && key.endsWith('/fence.json'))), false)
  f.advance(7 * DAY_MS)
  f.store.setJSON = original
  assert.equal((await f.idle().runDaily()).status, 'complete')
  assert.equal(Date.parse((await f.idle().inspect(identity)).expiresAt), f.now() + 180 * DAY_MS)
})

test('activation lost ACK is confirmed before account scanning; corrupt metadata holds deletion', async () => {
  const f = fixture()
  f.account()
  const original = f.store.setJSON
  f.store.setJSON = async (key, ...args) => {
    await original(key, ...args)
    if (key === IDLE_ACTIVATION_KEY) throw Error('synthetic lost ACK')
  }
  assert.equal((await f.idle().runDaily()).status, 'complete')
  const written = f.calls.findIndex(([op, key]) => op === 'set' && key === IDLE_ACTIVATION_KEY)
  const readBack = f.calls.findIndex(([op, key], index) => index > written && op === 'get' && key === IDLE_ACTIVATION_KEY)
  const scan = f.calls.findIndex(([op, key]) => op === 'list' && key === 'accounts/')
  assert.ok(written >= 0 && readBack > written && scan > readBack)
  const g = fixture()
  g.account()
  g.objects.set(IDLE_ACTIVATION_KEY, { version: 1, startedAt: 'invalid' })
  assert.equal((await g.idle().runDaily()).status, 'interrupted')
  assert.equal(g.calls.some(([op, key]) => op === 'delete' || (op === 'list' && key === 'accounts/')), false)
})

test('concurrent initializers converge without resetting the epoch on a later deployment', async () => {
  const f = fixture()
  f.account()
  await Promise.all([f.idle().run({ dryRun: false }), f.idle().run({ dryRun: false })])
  const persisted = structuredClone(f.objects.get(IDLE_ACTIVATION_KEY))
  f.advance(100 * DAY_MS)
  await f.idle().run({ dryRun: false })
  assert.deepEqual(f.objects.get(IDLE_ACTIVATION_KEY), persisted)
  assert.equal(f.calls.some(([op]) => op === 'delete'), false)
})

test('source rollback and explicit runtime stops disable execution without initializing', async () => {
  for (const [env, policy] of [[{}, { enabled: false }], [{ IDLE_CLEANUP_EXECUTE: 'true' }, { enabled: false }],
    [{ IDLE_CLEANUP_EXECUTE: 'false' }], [{ IDLE_CLEANUP_EXECUTE: '' }],
    [{ IDLE_POLICY_START_AT: 'invalid' }], [{ IDLE_POLICY_START_AT: '' }]]) {
    const f = fixture()
    f.account()
    assert.equal((await f.idle(env, policy).runDaily()).status, 'disabled')
    assert.equal(f.calls.length, 0)
  }
})

test('automatic scans retain reserved SMHE and later activity extends the persisted floor', async () => {
  const f = fixture()
  const owner = f.account('smhe', 'a'.repeat(32))
  const learner = f.account()
  await f.idle().runDaily()
  f.advance(100 * DAY_MS)
  await f.idle().touch(learner)
  f.advance(81 * DAY_MS)
  const result = await f.idle().run({ dryRun: false })
  assert.equal(result.results.find(row => row.userId === owner.userId).action, 'protected')
  assert.equal(result.results.find(row => row.userId === learner.userId).action, 'retain')
  assert.equal(f.calls.some(([op]) => op === 'delete'), false)
})
