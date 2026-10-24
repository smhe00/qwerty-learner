/* eslint-env node */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { build } from 'esbuild'
import { administratorCredentials } from '../../cloud-functions/_shared/administrator.js'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { DAY_MS, DRAIN_MS, createIdleAccounts, isAdministrator } from '../../cloud-functions/_shared/idle-accounts.js'

class Store {
  objects = new Map()
  writes = 0
  failDelete = ''
  afterSet = null
  afterDelete = null
  async get(key) { return structuredClone(this.objects.get(key) ?? null) }
  async setJSON(key, value) {
    this.writes++
    this.objects.set(key, structuredClone(value))
    await this.afterSet?.(key)
  }
  async list({ prefix }) {
    return { blobs: [...this.objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
  }
  async delete(key) {
    if (key === this.failDelete) throw new Error('provider failure must remain private')
    this.writes++
    this.objects.delete(key)
    await this.afterDelete?.(key)
  }
}
const epoch = Date.parse('2026-01-01T00:00:00Z')
const adminId = 'a'.repeat(32)
function fixture({ execute = true, age = 181, createdAge = 400 } = {}) {
  const store = new Store()
  let now = epoch + age * DAY_MS
  const userId = 'b'.repeat(32)
  const usernameHash = createHash('sha256').update('learner').digest('hex')
  const identity = { userId, usernameHash, username: 'learner', normalizedUsername: 'learner', status: 'active',
    createdAt: new Date(epoch - createdAge * DAY_MS).toISOString() }
  store.objects.set(`accounts/${usernameHash}/identity.json`, identity)
  const idle = createIdleAccounts({ store, adminUserId: adminId, startAt: new Date(epoch).toISOString(),
    execute, clock: () => now })
  return { store, identity, idle, advance: ms => { now += ms } }
}

test('SMHE privilege requires configured immutable ID, active identity and normalized name', () => {
  const admin = { userId: adminId, normalizedUsername: 'smhe', status: 'active' }
  assert.equal(isAdministrator(admin, adminId), true)
  for (const value of [{ ...admin, userId: 'b'.repeat(32) }, { ...admin, status: 'deleted' },
    { ...admin, normalizedUsername: 'someone' }]) assert.equal(isAdministrator(value, adminId), false)
  assert.equal(isAdministrator(admin, ''), false)
})

test('dry run has no writes and execution defaults off', async () => {
  const { idle, store } = fixture({ execute: false })
  assert.equal((await idle.run()).results[0].action, 'candidate')
  assert.equal(store.writes, 0)
  await assert.rejects(idle.run({ dryRun: false }), { code: 'idle_cleanup_disabled' })
  assert.equal(store.writes, 0)
})

test('legacy accounts get full 180 days from enable date, without an extra grace period', async () => {
  const { idle, advance } = fixture({ age: 149 })
  const row = (await idle.run()).results[0]
  assert.equal(row.action, 'retain')
  assert.equal(Date.parse(row.expiresAt), epoch + 180 * DAY_MS)
  assert.equal('noticeAt' in row, false)
  advance(30 * DAY_MS)
  assert.equal((await idle.run()).results[0].action, 'retain')
  advance(DAY_MS)
  assert.equal((await idle.run()).results[0].action, 'candidate')
})

test('authenticated cloud reads extend activity, daily records cannot regress', async () => {
  const { idle, identity, advance, store } = fixture({ age: 179 })
  await idle.touch(identity)
  const writes = store.writes
  await idle.touch(identity)
  assert.equal(store.writes, writes)
  advance(179 * DAY_MS)
  assert.equal((await idle.run()).results[0].action, 'retain')
  advance(2 * DAY_MS)
  assert.equal((await idle.run()).results[0].action, 'candidate')
})

test('administrator and designated SMHE are never deletion candidates', async () => {
  const { idle, store, identity } = fixture()
  identity.userId = adminId
  store.objects.set(`accounts/${identity.usernameHash}/identity.json`, identity)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'protected')
  identity.userId = 'c'.repeat(32)
  identity.normalizedUsername = 'smhe'
  store.objects.set(`accounts/${identity.usernameHash}/identity.json`, identity)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'protected')
  assert.equal(store.writes, 0)
})

test('Circle hold prevents automatic deletion without social data scrub', async () => {
  const { idle, store, identity } = fixture()
  store.objects.set(`social/v2/accounts/${identity.userId}/used.json`, { used: true })
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'circle_hold')
  assert.equal(store.writes, 0)
})

test('deletion drains requests first, removes exact namespaces, verifies identity last', async () => {
  const { idle, identity, store, advance } = fixture()
  const own = `users/${identity.userId}/payload.bin`
  const auth = `accounts/${identity.usernameHash}/auth/0001.json`
  store.objects.set(own, { learning: 'private' })
  store.objects.set(auth, { password: 'private' })
  store.objects.set('users/other/payload.bin', { keep: true })
  store.objects.set('social/unrelated', { keep: true })
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'draining')
  assert.ok(store.objects.has(own))
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'draining')
  advance(DRAIN_MS)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'deleted')
  for (const key of [own, auth, `accounts/${identity.usernameHash}/identity.json`]) {
    assert.equal(store.objects.has(key), false)
  }
  assert.deepEqual(await store.get('users/other/payload.bin'), { keep: true })
  assert.ok(store.objects.has('social/unrelated'))
  await assert.rejects(idle.touch(identity), { code: 'account_cleanup_pending' })
  await assert.rejects(idle.beforeRegister(identity.usernameHash), { code: 'username_cleanup_pending' })
  advance(DRAIN_MS)
  await idle.beforeRegister(identity.usernameHash)
})

test('returning login during drain cancels cleanup before any data deletion', async () => {
  const { idle, identity, store, advance } = fixture()
  const key = `users/${identity.userId}/snapshot`
  store.objects.set(key, { keep: true })
  await idle.run({ dryRun: false })
  await assert.rejects(idle.touch(identity), { code: 'account_cleanup_pending' })
  advance(DRAIN_MS)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'cancelled')
  await idle.touch(identity)
  assert.ok(store.objects.has(key))
  assert.equal((await idle.run()).results[0].action, 'retain')
})

test('failure retains identity and retries; provider error details never leave worker', async () => {
  const { idle, identity, store, advance } = fixture()
  const key = `users/${identity.userId}/snapshot`
  store.objects.set(key, { private: true })
  await idle.run({ dryRun: false })
  advance(DRAIN_MS)
  store.failDelete = key
  const failure = await idle.run({ dryRun: false })
  assert.deepEqual(failure.results, [{ action: 'error' }])
  assert.ok(store.objects.has(`accounts/${identity.usernameHash}/identity.json`))
  store.failDelete = ''
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'deleted')
})

test('time budget interrupts mid-account and next invocation safely resumes', async () => {
  const { idle, identity, store, advance } = fixture()
  for (let i = 0; i < 105; i++) store.objects.set(`users/${identity.userId}/part-${i}`, {})
  await idle.run({ dryRun: false })
  advance(DRAIN_MS)
  let deletions = 0
  store.afterDelete = async () => { if (++deletions === 10) advance(36000) }
  const paused = await idle.run({ dryRun: false, budgetMs: 35000 })
  assert.equal(paused.paused, true)
  assert.equal(paused.nextCursor, '')
  assert.ok(store.objects.has(`accounts/${identity.usernameHash}/identity.json`))
  await assert.rejects(idle.touch(identity), { code: 'account_cleanup_pending' })
  store.afterDelete = null
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'deleted')
})

test('concurrent fence during authentication refuses access after activity write', async () => {
  const { idle, identity, store } = fixture()
  store.afterSet = async key => {
    if (key.includes('/days/')) store.objects.set(`maintenance/idle/v1/${identity.userId}/fence.json`,
      { phase: 'draining', userId: identity.userId, createdAt: epoch })
  }
  await assert.rejects(idle.touch(identity), { code: 'account_cleanup_pending' })
})

test('bad timestamps, identity/key mismatch and incomplete listings fail closed', async () => {
  const { idle, identity, store } = fixture()
  identity.createdAt = 'broken'
  store.objects.set(`accounts/${identity.usernameHash}/identity.json`, identity)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'error')
  assert.equal(store.writes, 0)
  store.list = async () => ({})
  await assert.rejects(idle.run(), /Incomplete/)
})

test('activity guard runs only after valid password/session and registration guard precedes create', async () => {
  const store = new Store()
  const touched = []
  const guarded = []
  const backend = createBackendService({ storage: createEdgeOneBlobStorage(store),
    activityGuard: async identity => { touched.push(identity.userId) },
    registrationGuard: async hash => { guarded.push(hash) } })
  const account = await backend.register('learner', 'test-password')
  assert.equal(guarded.length, 1)
  assert.equal(touched.length, 1)
  await assert.rejects(backend.login('learner', 'bad-password'))
  await assert.rejects(backend.me('bad-token'))
  assert.equal(touched.length, 1)
  await backend.me(account.token)
  await backend.login('learner', 'test-password')
  assert.equal(touched.length, 3)
})

test('real gateway requires live owner session, pinned SMHE and separate scheduler credential', async () => {
  const store = new Store()
  globalThis.__idleRouteStore = store
  const backend = createBackendService({ storage: createEdgeOneBlobStorage(store) })
  const admin = await backend.register('SMHE', 'test-password')
  const normal = await backend.register('normal', 'test-password')
  const built = await build({ entryPoints: ['cloud-functions/api/[[default]].js'], bundle: true,
    platform: 'node', target: 'node20', format: 'esm', write: false, plugins: [{ name: 'store', setup(b) {
      b.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'store', namespace: 'idle' }))
      b.onLoad({ filter: /.*/, namespace: 'idle' }, () => ({
        contents: 'export const getStore = () => globalThis.__idleRouteStore', loader: 'js' }))
    } }] })
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  const env = { ADMIN_USER_ID: admin.user.userId, IDLE_POLICY_START_AT: new Date().toISOString(),
    ADMIN_PASSWORD: 'environment-only-password' }
  async function call(path, token, method = 'GET', extraEnv = {}, body = '{"dryRun":false}') {
    const headers = token ? { authorization: 'Bearer ' + token } : {}
    const response = await onRequest({ clientIp: '127.0.0.1', env: { ...env, ...extraEnv },
      request: new Request('https://example.test/api' + path, { method, headers,
        ...(method === 'POST' ? { body } : {}) }) })
    return { status: response.status, data: await response.json() }
  }
  assert.equal((await call('/admin/idle', admin.token)).status, 401)
  const signed = await call('/auth/login', undefined, 'POST', {}, JSON.stringify({ username: 'smhe', password: env.ADMIN_PASSWORD }))
  assert.equal(signed.status, 200)
  const token = signed.data.token
  assert.equal((await call('/admin/idle')).status, 401)
  assert.equal((await call('/admin/idle', normal.token)).status, 403)
  assert.equal((await call('/admin/access', token)).data.administrator, true)
  assert.equal((await call('/admin/access', token, 'GET', { ADMIN_USER_ID: normal.user.userId })).status, 401)
  assert.equal((await call('/admin/idle', token)).status, 200)
  assert.equal((await call('/admin/idle', token, 'POST')).status, 403)
  assert.equal((await call('/maintenance/idle', normal.token, 'POST')).data.status, 'disabled')
  assert.equal((await call('/maintenance/idle', undefined, 'POST')).status, 401)
  assert.equal((await call('/admin/access', token, 'GET', { ADMIN_PASSWORD: 'rotated-environment-password' })).status, 401)
  assert.equal((await call('/admin/storage', normal.token)).status, 403)
  assert.equal((await call('/admin/storage', token)).data.sizeComplete, false)
  assert.equal((await call('/account-policy')).data.enabled, true)
  await backend.login('SMHE', 'test-password') // revoke original administrator token
  assert.equal((await call('/admin/idle', token)).status, 401)
  delete globalThis.__idleRouteStore
})


test('administrator uses only environment password, disallows app password changes, rotates sessions', async () => {
  const store = new Store()
  const storage = createEdgeOneBlobStorage(store)
  const ordinary = createBackendService({ storage })
  const seeded = await ordinary.register('SMHE', 'old-database-password')
  const env = { ADMIN_USER_ID: seeded.user.userId, ADMIN_PASSWORD: 'Env-password-CaseSensitive' }
  const backend = createBackendService({ storage, credentials: administratorCredentials(env) })
  await assert.rejects(backend.login('smhe', 'old-database-password'), { code: 'incorrect_password' })
  await assert.rejects(backend.login('SMHE', 'env-password-casesensitive'), { code: 'incorrect_password' })
  await assert.rejects(backend.me(seeded.token), { code: 'session_revoked' })
  const session = await backend.login('SmHe', env.ADMIN_PASSWORD)
  await backend.me(session.token)
  await assert.rejects(backend.changePassword(session.token, env.ADMIN_PASSWORD, 'new-app-password'),
    { code: 'environment_password_managed' })
  await assert.rejects(backend.deleteAccount(session.token, env.ADMIN_PASSWORD), { code: 'administrator_protected' })
  assert.ok(!JSON.stringify([...store.objects.values()]).includes(env.ADMIN_PASSWORD))
  const rotated = createBackendService({ storage, credentials: administratorCredentials({ ...env, ADMIN_PASSWORD: 'rotated-password' }) })
  await assert.rejects(rotated.me(session.token), { code: 'session_revoked' })
  await assert.rejects(rotated.login('SMHE', env.ADMIN_PASSWORD), { code: 'incorrect_password' })
  await rotated.login('SMHE', 'rotated-password')
})

test('daily activity trigger runs once, no traffic needs no timer, next day continues', async () => {
  const { idle, identity, store, advance } = fixture()
  store.objects.set(`users/${identity.userId}/data`, {})
  const first = await idle.runDaily()
  assert.equal(first.counts.draining, 1)
  const writes = store.writes
  assert.equal((await idle.runDaily()).status, 'already_ran')
  assert.equal(store.writes, writes)
  advance(DRAIN_MS + 1)
  assert.equal((await idle.runDaily()).counts.deleted, 1)
})

test('daily cursor persists across runtime interruption without skipping the unfinished account', async () => {
  const { idle, identity, store, advance } = fixture()
  store.objects.set(`users/${identity.userId}/first`, {})
  store.objects.set(`users/${identity.userId}/second`, {})
  await idle.runDaily()
  advance(DRAIN_MS + 1)
  store.afterDelete = async key => { if (key.endsWith('/first')) advance(36000) }
  assert.equal((await idle.runDaily()).status, 'paused')
  assert.ok(store.objects.has(`accounts/${identity.usernameHash}/identity.json`))
  assert.equal((await idle.runDaily()).status, 'already_ran')
  store.afterDelete = null
  advance(DAY_MS)
  assert.equal((await idle.runDaily()).counts.deleted, 1)
})

test('simultaneous daily signals verify ownership and normally elect one worker', async () => {
  const { idle } = fixture()
  const results = await Promise.all([idle.runDaily(), idle.runDaily(), idle.runDaily()])
  assert.equal(results.filter(result => result.status === 'complete').length, 1)
  assert.equal(results.filter(result => result.status === 'already_ran').length, 2)
})

test('immutable deletion marker survives a missing or overwritten draining fence', async () => {
  const { idle, identity, store, advance } = fixture()
  const key = `users/${identity.userId}/part`
  store.objects.set(key, {})
  await idle.run({ dryRun: false })
  advance(DRAIN_MS)
  store.failDelete = key
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'error')
  store.objects.delete(`maintenance/idle/v1/${identity.userId}/fence.json`)
  await assert.rejects(idle.touch(identity), { code: 'account_cleanup_pending' })
  store.failDelete = ''
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'deleted')
})

test('out-of-namespace listing fails before an unrelated object can be deleted', async () => {
  const { idle, identity, store, advance } = fixture()
  await idle.run({ dryRun: false })
  advance(DRAIN_MS)
  const list = store.list.bind(store)
  store.list = async options => options.prefix === `users/${identity.userId}/`
    ? { blobs: [{ key: 'users/another-owner/private' }] } : list(options)
  store.objects.set('users/another-owner/private', { keep: true })
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'error')
  assert.deepEqual(await store.get('users/another-owner/private'), { keep: true })
})

test('a late Circle participation hold reopens the account before any destructive work', async () => {
  const { idle, identity, store, advance } = fixture()
  await idle.run({ dryRun: false })
  store.objects.set(`social/v2/accounts/${identity.userId}/used.json`, { used: true })
  advance(DRAIN_MS)
  assert.equal((await idle.run({ dryRun: false })).results[0].action, 'circle_hold')
  await idle.touch(identity)
  assert.ok(store.objects.has(`accounts/${identity.usernameHash}/identity.json`))
})
