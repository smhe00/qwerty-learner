/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import zlib from 'node:zlib'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { runBackendSelfTest } from '../../cloud-functions/_shared/self-test.js'

const clone = (value) => JSON.parse(JSON.stringify(value))

function gzipPayload(value) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64')
}

class MemoryStorage {
  constructor() {
    this.accounts = new Map()
    this.auth = new Map()
    this.sessions = new Map()
    this.revisions = new Map()
  }

  async createAccount(hash, identity) {
    if (this.accounts.has(hash)) return false
    this.accounts.set(hash, clone(identity))
    return true
  }

  async getAccount(hash) {
    const value = this.accounts.get(hash)
    return value ? clone(value) : null
  }

  async createAuthVersion(hash, version, record) {
    const key = `${hash}:${version}`
    if (this.auth.has(key)) return false
    this.auth.set(key, clone(record))
    return true
  }

  async pruneAuthVersions(hash, keepCount) {
    const entries = [...this.auth.keys()]
      .filter((key) => key.startsWith(`${hash}:`))
      .map((key) => ({ key, version: Number(key.slice(hash.length + 1)) }))
      .sort((left, right) => left.version - right.version)

    const obsolete = entries.slice(0, Math.max(0, entries.length - keepCount))
    for (const item of obsolete) this.auth.delete(item.key)

    return {
      deleted: obsolete.length,
      retained: entries.length - obsolete.length,
      latestVersion: entries.length ? entries[entries.length - 1].version : 0,
    }
  }

  async getLatestAuth(hash) {
    let latest = null

    for (const [key, value] of this.auth.entries()) {
      if (!key.startsWith(`${hash}:`)) continue
      const version = Number(key.slice(hash.length + 1))

      if (!latest || version > latest.version) {
        latest = { version, value }
      }
    }

    return latest ? clone(latest.value) : null
  }

  async createSessionVersion(hash, version, record) {
    const key = `${hash}:${version}`
    if (this.sessions.has(key)) return false
    this.sessions.set(key, clone(record))
    return true
  }

  async pruneSessionVersions(hash, keepCount) {
    const entries = [...this.sessions.keys()]
      .filter((key) => key.startsWith(`${hash}:`))
      .map((key) => ({ key, version: Number(key.slice(hash.length + 1)) }))
      .sort((left, right) => left.version - right.version)

    const obsolete = entries.slice(0, Math.max(0, entries.length - keepCount))
    for (const item of obsolete) this.sessions.delete(item.key)

    return {
      deleted: obsolete.length,
      retained: entries.length - obsolete.length,
      latestVersion: entries.length ? entries[entries.length - 1].version : 0,
    }
  }

  async getLatestSession(hash) {
    let latest = null

    for (const [key, value] of this.sessions.entries()) {
      if (!key.startsWith(`${hash}:`)) continue
      const version = Number(key.slice(hash.length + 1))

      if (!latest || version > latest.version) {
        latest = { version, value }
      }
    }

    return latest ? clone(latest.value) : null
  }

  async createRevision(userId, revision, snapshot) {
    const key = `${userId}:${revision}`
    if (this.revisions.has(key)) return false
    this.revisions.set(key, clone(snapshot))
    return true
  }

  async getLatestRevision(userId) {
    let latest = null

    for (const [key, snapshot] of this.revisions.entries()) {
      if (!key.startsWith(`${userId}:`)) continue
      const revision = Number(key.slice(userId.length + 1))

      if (!latest || revision > latest.revision) {
        latest = { revision, snapshot }
      }
    }

    return latest ? clone(latest) : null
  }

  async pruneRevisions(userId, keepCount) {
    const entries = [...this.revisions.keys()]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => ({
        key,
        revision: Number(key.slice(userId.length + 1)),
      }))
      .sort((left, right) => left.revision - right.revision)

    const obsolete = entries.slice(0, Math.max(0, entries.length - keepCount))

    for (const item of obsolete) {
      this.revisions.delete(item.key)
    }

    return {
      deleted: obsolete.length,
      retained: entries.length - obsolete.length,
      latestRevision: entries.length ? entries[entries.length - 1].revision : 0,
    }
  }

  authVersions(hash) {
    return [...this.auth.keys()]
      .filter((key) => key.startsWith(`${hash}:`))
      .map((key) => Number(key.slice(hash.length + 1)))
      .sort((a, b) => a - b)
  }

  sessionVersions(hash) {
    return [...this.sessions.keys()]
      .filter((key) => key.startsWith(`${hash}:`))
      .map((key) => Number(key.slice(hash.length + 1)))
      .sort((a, b) => a - b)
  }

  revisionVersions(userId) {
    return [...this.revisions.keys()]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => Number(key.slice(userId.length + 1)))
      .sort((a, b) => a - b)
  }

  async deleteUserData(usernameHash, userId) {
    const accountDeleted = this.accounts.delete(usernameHash)
    let authDeleted = 0
    let sessionsDeleted = 0
    let revisionsDeleted = 0

    for (const key of [...this.auth.keys()]) {
      if (key.startsWith(`${usernameHash}:`)) {
        this.auth.delete(key)
        authDeleted += 1
      }
    }

    for (const key of [...this.sessions.keys()]) {
      if (key.startsWith(`${usernameHash}:`)) {
        this.sessions.delete(key)
        sessionsDeleted += 1
      }
    }

    for (const key of [...this.revisions.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.revisions.delete(key)
        revisionsDeleted += 1
      }
    }

    return {
      accountDeleted,
      authDeleted,
      sessionsDeleted,
      revisionsDeleted,
    }
  }
}

test('cloud backend full contract', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({
    storage,
    maxSyncBytes: 4 * 1024 * 1024,
    snapshotRetention: 3,
  })

  const report = await runBackendSelfTest(service)

  assert.equal(report.success, true)
  assert.ok(report.steps.every((step) => step.ok))
  assert.equal(report.stepCount, report.steps.length)
  assert.equal(report.cleanup.accountDeleted, true)
  assert.ok(report.cleanup.sessionsDeleted >= 1)
})

test('snapshot retention keeps only the latest three full revisions', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({
    storage,
    snapshotRetention: 3,
  })

  const username = 'retention_test_user'
  const password = 'Retention-Test-Password-123'
  const registered = await service.register(username, password, 'retention-device')
  const userId = registered.user.userId

  let baseRevision = 0
  for (let revision = 1; revision <= 6; revision += 1) {
    const payloadBase64 = gzipPayload({ revision, value: `snapshot-${revision}` })

    const result = await service.putSync(registered.token, {
      baseRevision,
      payloadBase64,
      deviceId: 'retention-device',
      clientFormatVersion: 'qwerty-dexie-gzip-v2',
    })

    assert.equal(result.revision, revision)
    baseRevision = revision
  }

  assert.deepEqual(storage.revisionVersions(userId), [4, 5, 6])

  const latest = await service.getSync(registered.token)
  assert.equal(latest.revision, 6)

  await service.cleanupTestUser(username)
})


test('auth and session history retention bounds immutable version objects', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({
    storage,
    sessionHistoryRetention: 3,
    authHistoryRetention: 2,
  })

  const username = 'history_retention_user'
  let password = 'History-Retention-A1-Start'
  const registered = await service.register(username, password, 'register-device')
  const usernameHash = registered.token.split('.')[1]

  let active = registered
  for (let index = 0; index < 4; index += 1) {
    active = await service.login(username, password, `login-${index}`)
  }

  assert.deepEqual(storage.sessionVersions(usernameHash), [3, 4, 5])

  for (let index = 0; index < 3; index += 1) {
    const nextPassword = `History-Retention-B${index}-Password-123`
    active = await service.changePassword(
      active.token,
      password,
      nextPassword,
      `password-change-${index}`,
    )
    password = nextPassword
  }

  assert.deepEqual(storage.authVersions(usernameHash), [3, 4])
  assert.deepEqual(storage.sessionVersions(usernameHash), [6, 7, 8])

  const me = await service.me(active.token)
  assert.equal(me.user.userId, registered.user.userId)

  const latestLogin = await service.login(username, password, 'final-login')
  const latestMe = await service.me(latestLogin.token)
  assert.equal(latestMe.session.deviceId, 'final-login')
  assert.deepEqual(storage.sessionVersions(usernameHash), [7, 8, 9])

  await service.cleanupTestUser(username)
})


test('account deletion removes account, sessions and snapshots while requiring current password', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })

  const username = 'delete_account_user'
  let password = 'Delete-Account-A1-Password'
  const registered = await service.register(username, password, 'delete-register')
  const userId = registered.user.userId
  const usernameHash = registered.token.split('.')[1]

  let active = await service.login(username, password, 'delete-login')
  const nextPassword = 'Delete-Account-B2-Password'
  active = await service.changePassword(
    active.token,
    password,
    nextPassword,
    'delete-password-change',
  )
  password = nextPassword

  await service.putSync(active.token, {
    baseRevision: 0,
    payloadBase64: gzipPayload({ value: 'delete-me' }),
    deviceId: 'delete-device',
    clientFormatVersion: 'qwerty-dexie-gzip-v2',
  })

  await assert.rejects(
    () => service.deleteAccount(active.token, 'wrong-password-value'),
    (error) => error?.code === 'invalid_credentials',
  )

  assert.ok(await storage.getAccount(usernameHash))
  assert.deepEqual(storage.revisionVersions(userId), [1])

  const deleted = await service.deleteAccount(active.token, password)
  assert.equal(deleted.deleted.accountDeleted, true)
  assert.ok(deleted.deleted.sessionsDeleted >= 1)
  assert.ok(deleted.deleted.authDeleted >= 1)
  assert.equal(deleted.deleted.revisionsDeleted, 1)

  assert.equal(await storage.getAccount(usernameHash), null)
  assert.deepEqual(storage.authVersions(usernameHash), [])
  assert.deepEqual(storage.sessionVersions(usernameHash), [])
  assert.deepEqual(storage.revisionVersions(userId), [])

  await assert.rejects(
    () => service.me(active.token),
    (error) => error?.code === 'invalid_token',
  )
  await assert.rejects(
    () => service.login(username, password, 'deleted-login'),
    (error) => error?.code === 'invalid_credentials',
  )

  const registeredAgain = await service.register(
    username,
    'Delete-Account-C3-NewPassword',
    'delete-reregister',
  )
  assert.notEqual(registeredAgain.user.userId, userId)

  await service.cleanupTestUser(username)
})

test('sync upload rejects old or non-gzip formats', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })
  const registered = await service.register(
    'format_reject_user',
    'Format-Reject-A1-Password',
    'format-device',
  )

  await assert.rejects(
    () =>
      service.putSync(registered.token, {
        baseRevision: 0,
        payloadBase64: gzipPayload({ old: true }),
        clientFormatVersion: 'qwerty-sync-envelope-v1',
      }),
    (error) => error?.code === 'unsupported_sync_format',
  )

  await assert.rejects(
    () =>
      service.putSync(registered.token, {
        baseRevision: 0,
        payloadBase64: Buffer.from('not-gzip', 'utf8').toString('base64'),
        clientFormatVersion: 'qwerty-dexie-gzip-v2',
      }),
    (error) => error?.code === 'invalid_payload',
  )

  await service.cleanupTestUser('format_reject_user')
})


test('password length policy accepts four characters and rejects three', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })

  await assert.rejects(
    () => service.register('pw3_user', 'abc', 'pw3-device'),
    (error) => error?.code === 'invalid_password',
  )

  const registered = await service.register('pw4_user', 'abcd', 'pw4-device')
  assert.ok(registered.token)

  const login = await service.login('pw4_user', 'abcd', 'pw4-login')
  assert.equal(login.user.userId, registered.user.userId)

  await service.cleanupTestUser('pw4_user')
})
