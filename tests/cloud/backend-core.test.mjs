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
      clientFormatVersion: 'qwerty-backup-v3',
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


test('duplicate registration preserves the original account and revisions', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })

  const username = 'duplicate_register_user'
  const password = 'Orig'
  const replacementPassword = 'New2'

  const registered = await service.register(
    username,
    password,
    'duplicate-register-original',
  )
  const userId = registered.user.userId
  const usernameHash = registered.token.split('.')[1]

  const uploaded = await service.putSync(registered.token, {
    baseRevision: 0,
    payloadBase64: gzipPayload({ value: 'must-survive-duplicate-register' }),
    deviceId: 'duplicate-register-original',
    clientFormatVersion: 'qwerty-dexie-gzip-v2',
  })
  assert.equal(uploaded.revision, 1)

  await assert.rejects(
    () =>
      service.register(
        username.toUpperCase(),
        replacementPassword,
        'duplicate-register-replacement',
      ),
    (error) => error?.statusCode === 409 && error?.code === 'username_taken',
  )

  const identityAfter = await storage.getAccount(usernameHash)
  assert.equal(identityAfter.userId, userId)
  assert.deepEqual(storage.revisionVersions(userId), [1])

  const me = await service.me(registered.token)
  assert.equal(me.user.userId, userId)

  const snapshot = await service.getSync(registered.token)
  assert.equal(snapshot.revision, 1)
  assert.equal(
    snapshot.payloadBase64,
    gzipPayload({ value: 'must-survive-duplicate-register' }),
  )

  await assert.rejects(
    () => service.login(username, replacementPassword, 'duplicate-new-password'),
    (error) => error?.code === 'invalid_credentials',
  )

  const originalLogin = await service.login(
    username,
    password,
    'duplicate-original-password',
  )
  assert.equal(originalLogin.user.userId, userId)

  await service.cleanupTestUser(username)
})


test('qwerty-backup-v3 FSRS payload is stored byte-for-byte', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })

  const username = 'fsrs_payload_roundtrip_user'
  const registered = await service.register(
    username,
    'Fsrs-Payload-A1-Password',
    'fsrs-payload-device',
  )

  const payloadObject = {
    backupFormatVersion: 'qwerty-backup-v3',
    learningState: {
      currentDict: 'cet4',
      currentChapter: 3,
    },
    database: {
      data: {
        data: [
          {
            tableName: 'wordRecords',
            rows: [
              {
                id: 101,
                word: 'cold',
                dict: 'cet4',
                sourceMode: 'learn',
                learnItemKind: 'review',
                fsrsShadow: {
                  schemaVersion: 1,
                  libraryVersion: '5.4.2',
                  algorithmModel: 'fsrs-6',
                  parameterSetId:
                    'fsrs6-default-r0.90-no-fuzz-long-term-v1',
                  retrievabilityBefore: 0.82,
                  selectedIntervalDays: 7,
                  basicV2: {
                    dueAt: 123456,
                    nominalIntervalDays: 14,
                    reviewCount: 3,
                    lapseCount: 0,
                  },
                },
              },
            ],
          },
        ],
      },
    },
  }

  const payloadBase64 = gzipPayload(payloadObject)
  const uploaded = await service.putSync(registered.token, {
    baseRevision: 0,
    payloadBase64,
    deviceId: 'fsrs-payload-device',
    clientFormatVersion: 'qwerty-backup-v3',
  })

  assert.equal(uploaded.revision, 1)

  const downloaded = await service.getSync(registered.token)
  assert.equal(downloaded.clientFormatVersion, 'qwerty-backup-v3')
  assert.equal(downloaded.payloadBase64, payloadBase64)

  const decoded = JSON.parse(
    zlib.gunzipSync(Buffer.from(downloaded.payloadBase64, 'base64')).toString(
      'utf8',
    ),
  )
  assert.deepEqual(decoded, payloadObject)

  await service.cleanupTestUser(username)
})


test('S2 transitional meta exposes transport SHA but never mislabels V3 as canonical V4', async () => {
  const service = createBackendService({ storage: new MemoryStorage() })
  const registered = await service.register('s2_meta_contract', 's2-meta-password-123', 's2-device')
  const empty = await service.syncMeta(registered.token)
  assert.equal(empty.hasData, false)
  assert.equal(empty.payloadSha256, null)
  assert.equal(empty.logicalFingerprint, null)

  const uploaded = await service.putSync(registered.token, {
    baseRevision: 0,
    payloadBase64: gzipPayload({ words: ['safe-v3'] }),
    deviceId: 's2-device',
    clientFormatVersion: 'qwerty-backup-v3',
  })
  assert.equal(uploaded.revision, 1)
  assert.match(uploaded.payloadSha256, /^[a-f0-9]{64}$/)
  assert.equal(uploaded.payloadSha256, uploaded.dataSha256)
  assert.equal(uploaded.logicalFingerprint, null)

  const meta = await service.syncMeta(registered.token)
  const full = await service.getSync(registered.token)
  assert.equal(meta.payloadSha256, full.payloadSha256)
  assert.equal(meta.logicalFingerprint, null)
  assert.equal(full.logicalFingerprint, null)
  assert.equal(meta.clientFormatVersion, 'qwerty-backup-v3')

  await assert.rejects(
    service.putSync(registered.token, {
      baseRevision: 1,
      payloadBase64: gzipPayload({ unsafelyAdvertisedV4: true }),
      clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: 'f'.repeat(64),
    }),
    error => error?.code === 'unsupported_sync_format',
  )
  assert.equal((await service.syncMeta(registered.token)).revision, 1)
})

test('V4 revisioned backend accepts verified owner payload, publishes logical hash, blocks stale writers and legacy downgrades', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })
  const registration = await service.register('s2_v4_owner_test', 'password-works-123', 'device-A')
  const accountId = registration.user.userId
  const payloadV4 = (label) => ({
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId }, createdAt: '2026-10-10T00:00:00Z' },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1,
        data: { databaseName: 'RecordDB', databaseVersion: 6,
          tables: ['achievementEvents','achievementStates','chapterRecords',
            'reviewRecords','reviewWordStates','wordRecords']
            .map(name => ({ name, schema: '++id' })),
          data: ['achievementEvents','achievementStates','chapterRecords',
            'reviewRecords','reviewWordStates','wordRecords']
            .map(name => ({ tableName: name, inbound: true,
              rows: name === 'wordRecords' ? [{ id: 1, word: label }] : [] })) } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'test', currentChapter: 0 },
    },
  })
  const { verifyCompressedV4 } = await import('../../cloud-functions/_shared/sync-v4.js')
  // Derive an independent canonical hash from the same browser reference
  // projection, rather than accepting any client-provided hash without proof.
  const { createHash } = await import('node:crypto')
  const payload = payloadV4('A')
  const stableJson = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  const canonical = stableJson({
    database: { tables: payload.workspaceData.database.data.tables, data: payload.workspaceData.database.data.data },
    learnRuntime: payload.workspaceData.learnRuntime,
    navigation: payload.workspaceData.navigation,
    settings: payload.workspaceData.settings,
  })
  const canonicalHash = createHash('sha256').update(canonical).digest('hex')
  // Assert the authoritative server and payload normalization independently.
  assert.equal(verifyCompressedV4(zlib.gzipSync(Buffer.from(JSON.stringify(payload))), accountId, canonicalHash).logicalFingerprint, canonicalHash)
  const upload = await service.putSyncV4(registration.token, {
    baseRevision: 0, payloadBase64: gzipPayload(payload), clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: canonicalHash, deviceId: 'device-A',
  })
  assert.equal(upload.revision, 1)
  assert.equal(upload.logicalFingerprint, canonicalHash)
  assert.match(upload.payloadSha256, /^[a-f0-9]{64}$/)
  const cloud = await service.syncMeta(registration.token)
  assert.equal(cloud.logicalFingerprint, canonicalHash)
  assert.equal((await service.getSync(registration.token)).clientFormatVersion, 'qwerty-backup-v4')
  const anotherDevice = await service.login('s2_v4_owner_test', 'password-works-123', 'device-B')
  await assert.rejects(service.putSyncV4(anotherDevice.token, {
    baseRevision: 0, payloadBase64: gzipPayload(payload), clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: canonicalHash,
  }), error => error?.code === 'sync_conflict')
  await assert.rejects(service.putSync(anotherDevice.token, {
    baseRevision: 1, payloadBase64: gzipPayload({ old: true }),
    clientFormatVersion: 'qwerty-backup-v3',
  }), error => error?.code === 'sync_upgrade_required')
  assert.equal((await service.syncMeta(anotherDevice.token)).revision, 1)
})

test('V4 server refuses identity forgery, checksum mismatch and implicit V3 migration', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({ storage })
  const reg = await service.register('s2_v4_bad_test', 'password-works-456', 'device-A')
  const wrong = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId: 'forged-owner' }, createdAt: 'date' },
    workspaceData: {
      database: { data: { tables: [], data: [] } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'test', currentChapter: 0 },
    },
  }
  await assert.rejects(service.putSyncV4(reg.token, {
    baseRevision: 0, payloadBase64: gzipPayload(wrong), clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: 'f'.repeat(64),
  }), error => error?.code === 'invalid_v4_workspace')
  assert.equal((await service.syncMeta(reg.token)).revision, 0)
  await service.putSync(reg.token, {
    baseRevision: 0, payloadBase64: gzipPayload({ existing: 'V3' }),
    clientFormatVersion: 'qwerty-backup-v3',
  })
  await assert.rejects(service.putSyncV4(reg.token, {
    baseRevision: 1, payloadBase64: gzipPayload(wrong), clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: 'f'.repeat(64),
  }), error => error?.code === 'invalid_v4_workspace')
  assert.equal((await service.syncMeta(reg.token)).revision, 1)
})

test('S2 three-device stale CAS simulation chooses one immutable V4 winner per revision', async () => {
  const { createHash } = await import('node:crypto')
  const storage = new MemoryStorage()
  const service = createBackendService({ storage, snapshotRetention: 3 })
  const user = await service.register('s2_three_device', 'strong-password-test', 'device-1')
  const owner = user.user.userId
  const TABLES = [
    'achievementEvents','achievementStates','chapterRecords',
    'reviewRecords','reviewWordStates','wordRecords',
  ]
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  function upload(label, baseRevision) {
    const database = {
      formatName: 'dexie', formatVersion: 1,
      data: { databaseName: 'RecordDB', databaseVersion: 6,
        tables: TABLES.map(name => ({ name, schema: '++id' })),
        data: [{ tableName: 'wordRecords', inbound: true,
          rows: [{ id: 1, word: label }] }],
      },
    }
    const logical = {
      database: { tables: database.data.tables, data: database.data.data },
      learnRuntime: { dailySessions: {} },
      navigation: { currentDict: 'zhongkahexin', currentChapter: 0 },
      settings: { version: 1, values: {} },
    }
    const payload = {
      backupFormatVersion: 'qwerty-backup-v4',
      metadata: { createdAt: '2026-10-10', source: { kind: 'account', accountId: owner } },
      workspaceData: { database, learnRuntime: logical.learnRuntime,
        navigation: logical.navigation, settings: logical.settings },
    }
    return {
      baseRevision,
      payloadBase64: gzipPayload(payload),
      clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: createHash('sha256').update(stable(logical)).digest('hex'),
      deviceId: label,
    }
  }
  for (let baseRevision = 0; baseRevision < 2; baseRevision++) {
    const calls = ['device-A','device-B','device-C']
      .map(label => service.putSyncV4(user.token, upload(label, baseRevision)))
    const results = await Promise.allSettled(calls)
    const passed = results.filter(x => x.status === 'fulfilled')
    const rejected = results.filter(x => x.status === 'rejected')
    assert.equal(passed.length, 1)
    assert.equal(rejected.length, 2)
    assert.ok(rejected.every(x => x.reason.code === 'sync_conflict'))
    const cloud = await service.getSync(user.token)
    assert.equal(cloud.revision, baseRevision + 1)
    assert.equal(cloud.logicalFingerprint, passed[0].value.logicalFingerprint)
    assert.equal(cloud.payloadSha256, passed[0].value.payloadSha256)
    assert.equal(storage.revisionVersions(owner).length, baseRevision + 1)
  }
  await assert.rejects(service.putSync(user.token, {
    baseRevision: 2, payloadBase64: gzipPayload({ old: true }),
    clientFormatVersion: 'qwerty-backup-v3',
  }), error => error?.code === 'sync_upgrade_required')
  assert.equal((await service.syncMeta(user.token)).revision, 2)
})

test('P3b explicit V3-to-V4 migration requires pinned cloud evidence and account confirmation', async () => {
  const { createHash } = await import('node:crypto')
  const storage = new MemoryStorage()
  const service = createBackendService({ storage, snapshotRetention: 3 })
  const user = await service.register('p3b-migration-check', 'sufficient-password', 'A')
  const accountId = user.user.userId
  await service.putSync(user.token, {
    baseRevision: 0, payloadBase64: gzipPayload({ historical: true }),
    clientFormatVersion: 'qwerty-backup-v3',
  })
  const old = await service.syncMeta(user.token)
  const tables = ['wordRecords','chapterRecords','reviewRecords','reviewWordStates',
    'achievementEvents','achievementStates']
  const snapshot = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId }, createdAt: '2026-10-10' },
    workspaceData: {
      database: { formatName: 'dexie', data: {
        tables: tables.map(name => ({ name, schema: '++id' })),
        data: [{ tableName: 'wordRecords', inbound: true, rows: [{ id: 1, word: 'remember' }] }],
      } },
      learnRuntime: { dailySessions: {} }, settings: { version: 1, values: {} },
      navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
    },
  }
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  const workspace = snapshot.workspaceData
  const logical = {
    database: {
      tables: [...workspace.database.data.tables].sort((a, b) =>
        JSON.stringify(a.name).localeCompare(JSON.stringify(b.name))),
      data: [...workspace.database.data.data].sort((a, b) =>
        JSON.stringify(a.tableName).localeCompare(JSON.stringify(b.tableName))),
    },
    learnRuntime: workspace.learnRuntime, navigation: workspace.navigation, settings: workspace.settings,
  }
  const body = {
    baseRevision: 1, payloadBase64: gzipPayload(snapshot), clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: createHash('sha256').update(stable(logical)).digest('hex'),
    expectedRemoteSha256: old.payloadSha256,
    expectedRemoteFormat: 'qwerty-backup-v3', recoveryMode: 'migrate-v3',
    accountConfirmation: accountId,
  }
  await assert.rejects(service.putSyncV4(user.token, body),
    e => e?.code === 'sync_migration_required')
  for (const invalid of [
    { accountConfirmation: 'other-account' },
    { expectedRemoteSha256: '0'.repeat(64) },
    { expectedRemoteFormat: 'qwerty-backup-v4' },
    { recoveryMode: 'replace-v4' },
    { expectedRemoteSha256: null },
  ]) {
    await assert.rejects(service.putSyncV4Recovery(user.token, { ...body, ...invalid }),
      e => e?.code === 'recovery_precondition_failed')
  }
  assert.equal((await service.syncMeta(user.token)).revision, 1)
  const race = await Promise.allSettled([
    service.putSyncV4Recovery(user.token, body),
    service.putSyncV4Recovery(user.token, body),
  ])
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(race.filter(x => x.status === 'rejected').length, 1)
  assert.equal(race.find(x => x.status === 'rejected').reason.code, 'sync_conflict')
  const migrated = await service.syncMeta(user.token)
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.clientFormatVersion, 'qwerty-backup-v4')
  assert.equal(migrated.logicalFingerprint, body.logicalFingerprint)
  assert.ok(storage.revisions.has(accountId + ':1'), 'prior V3 revision survives initial migration')
  await assert.rejects(service.putSync(user.token, {
    baseRevision: 2, payloadBase64: gzipPayload({ old: true }),
    clientFormatVersion: 'qwerty-backup-v3',
  }), e => e?.code === 'sync_upgrade_required')
  const follow = {
    ...body, baseRevision: 2, recoveryMode: 'replace-v4',
    expectedRemoteFormat: 'qwerty-backup-v4',
    expectedRemoteSha256: migrated.payloadSha256,
    expectedRemoteLogicalFingerprint: migrated.logicalFingerprint,
  }
  await assert.rejects(service.putSyncV4Recovery(user.token, {
    ...follow, expectedRemoteLogicalFingerprint: 'f'.repeat(64),
  }), e => e?.code === 'recovery_precondition_failed')
  const accepted = await service.putSyncV4Recovery(user.token, follow)
  assert.equal(accepted.revision, 3)
  assert.equal(accepted.logicalFingerprint, body.logicalFingerprint)
})
