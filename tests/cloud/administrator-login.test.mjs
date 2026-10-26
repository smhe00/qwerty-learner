/* eslint-env node */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { administratorCredentials, loadAdministrator } from '../../cloud-functions/_shared/administrator.js'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { DAY_MS, DRAIN_MS, createIdleAccounts, isAdministrator } from '../../cloud-functions/_shared/idle-accounts.js'

const password = 'synthetic-administrator-password'
const env = { ADMIN_PASSWORD: password }
const hash = name => createHash('sha256').update(name).digest('hex')
const identityKey = name => `accounts/${hash(name)}/identity.json`
const bindingKey = 'maintenance/administrator/v1.json'
class Store {
  objects = new Map()
  writes = 0
  afterSet = null
  async get(key) { return structuredClone(this.objects.get(key) ?? null) }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) throw new Error('already exists')
    this.writes++
    this.objects.set(key, structuredClone(value))
    await this.afterSet?.(key)
  }
  async list({ prefix = '' }) {
    return { blobs: [...this.objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
  }
  async delete(key) { this.writes++; this.objects.delete(key) }
}
async function fixture(store = new Store(), configuration = env, options = {}) {
  const administrator = await loadAdministrator({ store, env: configuration })
  const storage = createEdgeOneBlobStorage(store)
  const backend = createBackendService({ storage, credentials: administrator.credentials, ...options })
  return { store, administrator, storage, backend }
}

test('new site needs no registration; correct admin login binds once and preserves single active session', async () => {
  const { backend, administrator, storage, store } = await fixture()
  assert.equal(store.writes, 0)
  for (const name of ['admin', 'AdMiN', 'smhe', 'SMHE']) {
    await assert.rejects(backend.register(name, password), { code: 'administrator_account_reserved' })
  }
  await assert.rejects(backend.login('admin', 'synthetic-wrong'), { code: 'incorrect_password' })
  await assert.rejects(backend.login('smhe', password), { code: 'administrator_login_name' })
  assert.equal(store.writes, 0)
  const first = await backend.login('AdMiN', password, 'first-device')
  assert.equal(first.user.username, 'admin')
  assert.equal(administrator.userId, first.user.userId)
  assert.equal(first.token.split('.').length, 4)
  assert.deepEqual((await backend.me(first.token)).user, first.user)
  const canonical = await storage.getAccount(hash('smhe'))
  assert.equal(canonical.initialAuth.environmentManaged, true)
  assert.equal('password' in canonical.initialAuth, false)
  assert.equal(await storage.getAccount(hash('admin')), null)
  const next = await fixture(store)
  const second = await next.backend.login('admin', password, 'second-device')
  assert.deepEqual(second.user, first.user)
  await next.backend.me(second.token)
  await assert.rejects(next.backend.me(first.token), { code: 'session_revoked' })
  assert.ok(!JSON.stringify([...store.objects.values()]).includes(password))
})

test('missing, empty, malformed or incorrectly cased configuration cannot initialize an administrator', async () => {
  for (const configuration of [{}, { admin_password: password }, { ADMIN_PASSWORD: '' },
    { ADMIN_PASSWORD: null }, { ADMIN_PASSWORD: 'bad' }, { ADMIN_PASSWORD: 1234 }]) {
    const { backend, store } = await fixture(new Store(), configuration)
    await assert.rejects(backend.login('admin', password), { code: 'administrator_password_unconfigured' })
    assert.equal(store.writes, 0)
    assert.equal(store.objects.size, 0)
  }
})

test('legacy administrator retains ID, learning and feedback; old ordinary credentials grant no access', async () => {
  const store = new Store(), storage = createEdgeOneBlobStorage(store)
  const legacy = await createBackendService({ storage }).register('SMHE', 'synthetic-old-ordinary-password')
  const learning = `users/${legacy.user.userId}/snapshot`
  const feedback = `users/${legacy.user.userId}/feedback/v1/old/root.json`
  store.objects.set(learning, { lessons: [1, 2, 3] })
  store.objects.set(feedback, { text: 'synthetic feedback' })
  const canonical = await storage.getAccount(hash('smhe'))
  const { backend, administrator } = await fixture(store)
  const before = store.writes
  await assert.rejects(backend.login('admin', 'synthetic-old-ordinary-password'), { code: 'incorrect_password' })
  await assert.rejects(backend.me(legacy.token), { code: 'session_revoked' })
  assert.equal(store.writes, before)
  const signed = await backend.login('admin', password)
  assert.equal(signed.user.userId, legacy.user.userId)
  assert.equal(signed.user.username, 'admin')
  assert.equal(administrator.userId, legacy.user.userId)
  assert.deepEqual(await storage.getAccount(hash('smhe')), canonical)
  assert.deepEqual(await store.get(learning), { lessons: [1, 2, 3] })
  assert.deepEqual(await store.get(feedback), { text: 'synthetic feedback' })
})

test('environment password rotation or removal revokes sessions; app password change and self-delete remain forbidden', async () => {
  const { store, backend } = await fixture()
  const first = await backend.login('admin', password)
  await assert.rejects(backend.changePassword(first.token, password, 'synthetic-new-app-password'), { code: 'environment_password_managed' })
  await assert.rejects(backend.deleteAccount(first.token, password), { code: 'administrator_protected' })
  const changed = 'synthetic-rotated-password'
  const rotated = (await fixture(store, { ADMIN_PASSWORD: changed })).backend
  await assert.rejects(rotated.me(first.token), { code: 'session_revoked' })
  await assert.rejects(rotated.login('admin', password), { code: 'incorrect_password' })
  const current = await rotated.login('admin', changed)
  assert.equal(current.user.userId, first.user.userId)
  const disabled = (await fixture(store, {})).backend
  const before = store.writes
  await assert.rejects(disabled.me(current.token), { code: 'session_revoked' })
  await assert.rejects(disabled.login('admin', changed), { code: 'administrator_password_unconfigured' })
  assert.equal(store.writes, before)
})

test('an existing ordinary admin name is never overwritten, promoted or hidden by a second identity', async () => {
  const store = new Store(), storage = createEdgeOneBlobStorage(store)
  const ordinary = createBackendService({ storage })
  const old = await ordinary.register('admin', 'synthetic-ordinary-password')
  const { backend, administrator } = await fixture(store)
  const before = structuredClone([...store.objects]), writes = store.writes
  await assert.rejects(backend.login('admin', password), { code: 'administrator_name_conflict' })
  assert.equal(administrator.isAdministrator({ ...old.user, normalizedUsername: 'admin', status: 'active' }), false)
  assert.equal((await backend.me(old.token)).user.userId, old.user.userId)
  assert.deepEqual([...store.objects], before)
  assert.equal(store.writes, writes)
})

test('bound or configured identity cannot be recreated or rebound when missing or changed', async () => {
  const { store, backend } = await fixture()
  const first = await backend.login('admin', password)
  await assert.rejects(fixture(store, { ...env, ADMIN_USER_ID: 'e'.repeat(32) }), { code: 'administrator_binding_mismatch' })
  const canonical = await store.get(identityKey('smhe'))
  store.objects.set(identityKey('smhe'), { ...canonical, userId: 'e'.repeat(32) })
  const changed = (await fixture(store)).backend
  await assert.rejects(changed.login('admin', password), { code: 'administrator_identity_mismatch' })
  store.objects.delete(identityKey('smhe'))
  const writes = store.writes
  await assert.rejects(changed.login('admin', password), { code: 'administrator_binding_unavailable' })
  assert.equal(store.writes, writes)
  assert.equal((await store.get(bindingKey)).userId, first.user.userId)
  const empty = await fixture(new Store(), { ...env, ADMIN_USER_ID: first.user.userId })
  await assert.rejects(empty.backend.login('admin', password), { code: 'administrator_binding_unavailable' })
  assert.equal(empty.store.writes, 0)
})

test('lost durable identity and binding receipts are confirmed by canonical reads', async () => {
  const store = new Store()
  store.afterSet = async key => {
    if (key === identityKey('smhe') || key === bindingKey) throw new Error('lost durable write response')
  }
  const { backend, administrator } = await fixture(store)
  const signed = await backend.login('admin', password)
  assert.equal(administrator.userId, signed.user.userId)
  await backend.me(signed.token)
  assert.equal(store.writes, 2)
})

test('unconfirmed binding returns no session; later explicit login adopts the same persisted identity', async () => {
  const store = new Store(), set = store.setJSON.bind(store)
  store.setJSON = async (key, value, options) => {
    if (key === bindingKey) throw new Error('no receipt')
    return set(key, value, options)
  }
  const first = await fixture(store)
  await assert.rejects(first.backend.login('admin', password), { code: 'administrator_binding_unavailable' })
  const saved = await store.get(identityKey('smhe'))
  assert.ok(saved.userId)
  assert.equal(await store.get(bindingKey), null)
  store.setJSON = set
  const retry = await fixture(store)
  const signed = await retry.backend.login('admin', password)
  assert.equal(signed.user.userId, saved.userId)
  await retry.backend.me(signed.token)
})

test('concurrent first logins never return a different bound administrator', async () => {
  const store = new Store()
  const left = await fixture(store), right = await fixture(store)
  const outcomes = await Promise.allSettled([left.backend.login('admin', password), right.backend.login('admin', password)])
  const binding = await store.get(bindingKey)
  assert.ok(outcomes.some(result => result.status === 'fulfilled'))
  for (const result of outcomes) {
    if (result.status === 'fulfilled') assert.equal(result.value.user.userId, binding.userId)
    else assert.ok(['username_taken', 'administrator_identity_mismatch', 'session_race'].includes(result.reason.code), result.reason.code)
  }
  assert.equal((await store.get(identityKey('smhe'))).userId, binding.userId)
  const retry = await fixture(store)
  assert.equal((await retry.backend.login('admin', password)).user.userId, binding.userId)
})

test('administrator preflight is read-only and cannot initialize or enroll', async () => {
  const { backend, store } = await fixture(new Store(), env, { handoffPreflight: true })
  await assert.rejects(backend.preflightLogin('admin', password), { code: 'account_not_found' })
  await assert.rejects(backend.preflightRegister('admin', password), { code: 'handoff_managed_registration_disabled' })
  assert.equal(store.writes, 0)
  const signed = await backend.login('admin', password)
  const writes = store.writes
  assert.equal((await backend.preflightLogin('admin', password)).accountId, signed.user.userId)
  assert.equal(store.writes, writes)
})

test('metadata retries transient reads without returning provider details or storing the password', async () => {
  const store = new Store(), get = store.get.bind(store)
  let failures = 2
  store.get = async key => {
    if (key === bindingKey && failures-- > 0) throw new Error('synthetic transient metadata failure')
    return get(key)
  }
  const { backend } = await fixture(store)
  await backend.login('admin', password)
  assert.equal(store.writes, 2)
})

test('admin, legacy smhe and pinned identity survive repeated executing cleanup beyond 180 days without configuration', async () => {
  for (const [name, pinned] of [['admin', false], ['smhe', false], ['former-name', true]]) {
    const store = new Store(), userId = 'a'.repeat(32)
    const epoch = Date.parse('2025-01-01T00:00:00Z')
    let now = epoch + 400 * DAY_MS
    const identity = { userId, username: name, normalizedUsername: name, usernameHash: hash(name),
      status: 'active', createdAt: new Date(epoch).toISOString() }
    const protectedKeys = [identityKey(name), `users/${userId}/snapshot`, `accounts/${hash(name)}/sessions/0001.json`,
      `users/${userId}/feedback/v1/old/root.json`, `feedback/v1/index/a-${userId}/old.json`]
    store.objects.set(protectedKeys[0], identity)
    for (const key of protectedKeys.slice(1)) store.objects.set(key, { keep: true })
    // Even stale cleanup markers must not allow resuming deletion of a protected identity.
    store.objects.set(`maintenance/idle/v1/${userId}/deleting.json`, { userId, createdAt: epoch })
    const before = structuredClone([...store.objects])
    const idle = createIdleAccounts({ store, adminUserId: pinned ? userId : '', startAt: new Date(epoch).toISOString(),
      execute: true, clock: () => now })
    for (let pass = 0; pass < 3; pass++) {
      const result = (await idle.run({ dryRun: false })).results[0]
      assert.equal(result.eligible, true)
      assert.equal(result.action, 'protected')
      now += 200 * DAY_MS
    }
    assert.equal(store.writes, 0)
    assert.deepEqual([...store.objects], before)
    assert.equal(isAdministrator(identity, ''), false, 'Cleanup exemption is not administrator permission')
  }
})

test('ordinary expired account is still deleted after draining alongside an inactive administrator', async () => {
  const { store, backend } = await fixture()
  const admin = await backend.login('admin', password)
  const ordinary = await backend.register('ordinary-learner', 'synthetic-learner-password')
  const epoch = Date.now(), activeKeys = [...store.objects.keys()]
    .filter(key => key === bindingKey || key.includes(hash('smhe')))
  let now = epoch + 181 * DAY_MS
  const idle = createIdleAccounts({ store, adminUserId: '', startAt: new Date(epoch).toISOString(), execute: true, clock: () => now })
  assert.equal((await idle.run({ dryRun: false })).results.find(row => row.userId === ordinary.user.userId).action, 'draining')
  now += DRAIN_MS + 1
  const rows = (await idle.run({ dryRun: false })).results
  assert.equal(rows.find(row => row.userId === ordinary.user.userId).action, 'deleted')
  assert.equal(rows.find(row => row.userId === admin.user.userId).action, 'protected')
  for (const key of activeKeys) assert.ok(store.objects.has(key))
  assert.equal(store.objects.has(identityKey('ordinary-learner')), false)
})

test('name alone never grants privilege for admin or legacy smhe', () => {
  for (const name of ['admin', 'smhe']) {
    const identity = { userId: 'a'.repeat(32), normalizedUsername: name, status: 'active' }
    assert.equal(isAdministrator(identity, ''), false)
    assert.equal(isAdministrator(identity, 'b'.repeat(32)), false)
    assert.equal(isAdministrator(identity, identity.userId), true)
    assert.equal(isAdministrator({ ...identity, status: 'deleted' }, identity.userId), false)
  }
  assert.equal(administratorCredentials({}).matches({ userId: 'a'.repeat(32), normalizedUsername: 'smhe', status: 'active' }), false)
})
