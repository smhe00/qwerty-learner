/* eslint-env node */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { createBackendService } from '../../cloud-functions/_shared/core.js'

const clone = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)))

class FakeBlobStore {
  constructor() {
    this.objects = new Map()
    this.getFailures = 0
    this.listFailures = 0
    this.deleteFailures = 0
    this.setFailures = 0
    this.ambiguousOnlyIfNewWrite = false
    this.ignoreOnlyIfNew = false
  }

  async get(key) {
    if (this.getFailures > 0) {
      this.getFailures -= 1
      throw new Error('transient get failure')
    }

    return this.objects.has(key) ? clone(this.objects.get(key)) : null
  }

  async list({ prefix }) {
    if (this.listFailures > 0) {
      this.listFailures -= 1
      throw new Error('transient list failure')
    }

    return {
      blobs: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    }
  }

  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && !this.ignoreOnlyIfNew && this.objects.has(key)) {
      throw new Error('already exists')
    }

    if (this.setFailures > 0) {
      this.setFailures -= 1
      throw new Error('transient set failure')
    }

    this.objects.set(key, clone(value))

    if (options.onlyIfNew && this.ambiguousOnlyIfNewWrite) {
      this.ambiguousOnlyIfNewWrite = false
      throw new Error('response lost after durable write')
    }
  }

  async delete(key) {
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1
      throw new Error('transient delete failure')
    }

    this.objects.delete(key)
  }
}

test('Blob adapter retries transient strong reads', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'a'.repeat(64)
  const identity = { userId: 'u1', status: 'active' }

  store.objects.set(`accounts/${hash}/identity.json`, identity)
  store.getFailures = 2

  assert.deepEqual(await storage.getAccount(hash), identity)
  assert.equal(store.getFailures, 0)
})

test('Blob adapter retries transient list operations for latest session lookup', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'b'.repeat(64)

  assert.equal(
    await storage.createSessionVersion(hash, 2, { version: 2, tokenHash: 'x' }),
    true,
  )

  store.listFailures = 2

  assert.deepEqual(await storage.getLatestSession(hash), {
    version: 2,
    tokenHash: 'x',
  })
  assert.equal(store.listFailures, 0)
})

test('Blob adapter recovers onlyIfNew ambiguous durable success', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'c'.repeat(64)
  const identity = {
    userId: 'u-ambiguous',
    status: 'active',
    nested: { z: 1, a: 2 },
  }

  store.ambiguousOnlyIfNewWrite = true

  assert.equal(await storage.createAccount(hash, identity), true)
  assert.deepEqual(await storage.getAccount(hash), identity)
})

test('Blob adapter still distinguishes a genuine onlyIfNew conflict', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'd'.repeat(64)

  assert.equal(
    await storage.createAccount(hash, { userId: 'winner', status: 'active' }),
    true,
  )

  assert.equal(
    await storage.createAccount(hash, { userId: 'loser', status: 'active' }),
    false,
  )
})

test('Blob adapter retries transient delete operations during cleanup', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'e'.repeat(64)
  const userId = 'cleanup-user'

  await storage.createAccount(hash, { userId, status: 'active' })
  await storage.createSessionVersion(hash, 2, { version: 2 })
  await storage.createRevision(userId, 1, { revision: 1 })

  store.deleteFailures = 2

  const result = await storage.deleteUserData(hash, userId)

  assert.equal(result.accountDeleted, true)
  assert.equal(result.sessionsDeleted, 1)
  assert.equal(result.revisionsDeleted, 1)
  assert.equal(store.deleteFailures, 0)
})


test('Blob adapter preflight protects accounts even if provider ignores onlyIfNew', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'f'.repeat(64)

  assert.equal(
    await storage.createAccount(hash, { userId: 'original', status: 'active' }),
    true,
  )

  store.ignoreOnlyIfNew = true

  assert.equal(
    await storage.createAccount(hash, { userId: 'replacement', status: 'active' }),
    false,
  )

  assert.deepEqual(await storage.getAccount(hash), {
    userId: 'original',
    status: 'active',
  })
})


test('V4 chunked Blob revision commits only a compact manifest and round-trips bytes', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const crypto = await import('node:crypto')
  const payload = crypto.randomBytes(1024 * 1024)
  const encoded = payload.toString('base64')
  const digest = crypto.createHash('sha256').update(payload).digest('hex')
  // The fake models the production observation: large single JSON writes fail.
  const originalSet = store.setJSON.bind(store)
  store.setJSON = async (key, value, options) => {
    if (JSON.stringify(value).length > 380000) throw new Error('simulated large Blob setJSON 500')
    return originalSet(key, value, options)
  }
  const input = { revision: 1, sizeBytes: payload.length, dataSha256: digest,
    payloadBase64: encoded, clientFormatVersion: 'qwerty-backup-v4' }
  assert.equal(await storage.createRevision('chunk-owner', 1, input), true)
  const manifest = store.objects.get('users/chunk-owner/revisions/000000000001.json')
  assert.equal(manifest.payloadBase64, null)
  assert.ok(manifest.chunkedPayload.count > 1)
  const result = await storage.getLatestRevision('chunk-owner')
  assert.equal(result.revision, 1)
  assert.equal(result.snapshot.payloadBase64, encoded)
  assert.equal(result.snapshot.dataSha256, digest)
  const summary = await storage.getLatestRevisionMeta('chunk-owner')
  assert.equal(summary.snapshot.revision, 1)
  assert.equal(summary.snapshot.payloadBase64, null)
})

test('V4 chunk corruption fails closed and account deletion also removes parts', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const crypto = await import('node:crypto')
  const payload = crypto.randomBytes(400000)
  const sha = crypto.createHash('sha256').update(payload).digest('hex')
  await storage.createRevision('chunk-owner', 1, { revision: 1, sizeBytes: payload.length,
    dataSha256: sha, payloadBase64: payload.toString('base64'),
    clientFormatVersion: 'qwerty-backup-v4' })
  const key = [...store.objects.keys()].find(key => key.includes('/revision-parts/'))
  assert.ok(key)
  store.objects.delete(key)
  await assert.rejects(storage.getLatestRevision('chunk-owner'), /missing or invalid Blob chunks/)
  const name = 'f'.repeat(64)
  await storage.createAccount(name, { userId: 'chunk-owner' })
  const deleted = await storage.deleteUserData(name, 'chunk-owner')
  assert.ok(deleted.revisionPartsDeleted >= 1)
  assert.equal([...store.objects.keys()].filter(k => k.includes('chunk-owner')).length, 0)
})

test('failed chunk precommit cannot advance visible revision', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const crypto = await import('node:crypto')
  const bytes = crypto.randomBytes(400000)
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  const oldSet = store.setJSON.bind(store)
  store.setJSON = async (key, value, options) => {
    if (key.includes('revision-parts') && key.includes('0001.json')) {
      throw new Error('simulated permanent part outage')
    }
    return oldSet(key, value, options)
  }
  await assert.rejects(storage.createRevision('fault', 1, {
    revision: 1, sizeBytes: bytes.length, dataSha256: sha,
    payloadBase64: bytes.toString('base64'), clientFormatVersion: 'qwerty-backup-v4',
  }), /permanent part outage/)
  assert.equal(await storage.getLatestRevisionMeta('fault'), null)
  assert.equal(await storage.getLatestRevision('fault'), null)
})


test('end-to-end V4 >1 MiB backend write/read through size-limited Blob, without changing protocol', async () => {
  const blob = new FakeBlobStore()
  const originalSet = blob.setJSON.bind(blob)
  blob.setJSON = async (key, value, options) => {
    if (Buffer.byteLength(JSON.stringify(value)) > 380000) {
      throw new Error('simulated production oversized Blob JSON write')
    }
    return originalSet(key, value, options)
  }
  const storage = createEdgeOneBlobStorage(blob)
  const service = createBackendService({ storage })
  const user = await service.register('v4-chunked-backend', 'strong-password-123', 'device-A')
  const accountId = user.user.userId
  const names = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const bigTelemetry = randomBytes(1024 * 1024).toString('base64')
  const tables = names.map(name => ({ name, schema: '++id' }))
  const data = names.map(name => ({ tableName: name, inbound: true,
    rows: name === 'wordRecords' ? [{ id: 1, word: 'careful',
      typingTelemetry: { synthetic: bigTelemetry } }] : [],
  }))
  const workspace = {
    database: { formatName: 'dexie', formatVersion: 1,
      data: { databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
    learnRuntime: { dailySessions: {} }, settings: { version: 1, values: {} },
    navigation: { currentDict: 'test', currentChapter: 0 },
  }
  const v4 = { backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId }, createdAt: '2026-10-13' },
    workspaceData: workspace }
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  const logicalFingerprint = createHash('sha256').update(stable({
    database: { tables, data }, learnRuntime: workspace.learnRuntime,
    settings: workspace.settings, navigation: workspace.navigation,
  })).digest('hex')
  const payload = gzipSync(Buffer.from(JSON.stringify(v4)))
  assert.ok(payload.byteLength > 1_000_000, 'must reproduce the observed failing size class')
  const compressedSha = createHash('sha256').update(payload).digest('hex')
  const input = { baseRevision: 0, logicalFingerprint,
    clientFormatVersion: 'qwerty-backup-v4',
    payloadBase64: payload.toString('base64'), deviceId: 'v4-stress-test' }
  const written = await service.putSyncV4(user.token, input)
  assert.equal(written.revision, 1)
  assert.equal(written.logicalFingerprint, logicalFingerprint)
  assert.equal(written.payloadSha256, compressedSha)
  const compact = await storage.getLatestRevisionMeta(accountId)
  assert.equal(compact.snapshot.payloadBase64, null)
  assert.ok(compact.snapshot.chunkedPayload.count > 1)
  assert.equal((await service.syncMeta(user.token)).payloadSha256, compressedSha)
  const fetched = await service.getSync(user.token)
  assert.equal(fetched.payloadBase64, input.payloadBase64)
  assert.equal(fetched.payloadSha256, compressedSha)
  assert.equal(Buffer.from(fetched.payloadBase64, 'base64').equals(payload), true)
  await assert.rejects(service.putSyncV4(user.token, input),
    error => error?.code === 'sync_conflict')
})
