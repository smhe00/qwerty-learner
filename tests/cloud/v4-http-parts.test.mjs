/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import {
  V4_HTTP_PART_BYTES, V4_HTTP_PART_CHARS, commitV4Upload, receiveV4UploadPart,
} from '../../cloud-functions/_shared/v4-http-parts.js'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const sha = data => crypto.createHash('sha256').update(data).digest('hex')
const clone = value => value === null ? null : structuredClone(value)
class Blob {
  constructor() { this.objects = new Map(); this.lostAck = false }
  async get(key, options = {}) {
    if (!this.objects.has(key)) return null
    const raw = this.objects.get(key)
    if (options.type === 'arrayBuffer') {
      if (!(raw instanceof ArrayBuffer)) throw Error('expected binary Blob data')
      return raw.slice(0)
    }
    return clone(raw)
  }
  async set(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) throw Error('already exists')
    if (!(value instanceof ArrayBuffer)) throw Error('expected ArrayBuffer input')
    this.objects.set(key, value.slice(0))
    if (this.lostAck) { this.lostAck = false; throw Error('ambiguous ACK') }
  }
  async list({ prefix }) {
    return { blobs: [...this.objects.keys()].filter(key => key.startsWith(prefix))
      .map(key => ({ key })) }
  }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) throw Error('already exists')
    this.objects.set(key, clone(value))
    if (this.lostAck) { this.lostAck = false; throw Error('ambiguous ACK') }
  }
  async delete(key) { this.objects.delete(key) }
}
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function fixture(telemetryBytes = 180 * 1024) {
  const raw = new Blob()
  const storage = createEdgeOneBlobStorage(raw)
  const service = createBackendService({ storage })
  const user = await service.register(
    'v4parttest' + crypto.randomBytes(4).toString('hex'), 'long-test-password')
  const { token } = user
  const accountId = user.user.userId
  const tableNames = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = tableNames.map(name => ({ name, schema: '++id' }))
  const data = tableNames.map(tableName => ({ tableName, inbound: true,
    rows: tableName === 'wordRecords' ? [{
      id: 1, word: 'example', dict: 'test',
      typingTelemetry: { synthetic: crypto.randomBytes(telemetryBytes).toString('base64') },
    }] : [],
  }))
  const workspaceData = {
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'test', currentChapter: 0 },
  }
  const snapshot = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-14T00:00:00Z',
      source: { kind: 'account', accountId } }, workspaceData,
  }
  const logicalFingerprint = sha(stable({
    database: { tables, data }, learnRuntime: workspaceData.learnRuntime,
    settings: workspaceData.settings, navigation: workspaceData.navigation,
  }))
  const zipped = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  assert.equal(verifyCompressedV4(zipped, accountId, logicalFingerprint).logicalFingerprint,
    logicalFingerprint)
  const payloadBase64 = zipped.toString('base64')
  const payloadSha256 = sha(zipped)
  const parts = Array.from(
    { length: Math.ceil(payloadBase64.length / V4_HTTP_PART_CHARS) },
    (_, index) => {
      const data = payloadBase64.slice(index * V4_HTTP_PART_CHARS,
        (index + 1) * V4_HTTP_PART_CHARS)
      return { payloadSha256, index,
        count: Math.ceil(payloadBase64.length / V4_HTTP_PART_CHARS),
        partSha256: sha(data), data }
    },
  )
  const manifest = {
    payloadSha256, count: parts.length,
    partSha256s: parts.map(part => part.partSha256),
    baseRevision: 0, clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint, deviceId: 'test-device',
  }
  return { raw, storage, service, token, accountId, parts, manifest }
}
function binaryFixture(f) {
  const binary = Buffer.from(f.parts.map(p => p.data).join(''), 'base64')
  const count = Math.ceil(binary.length / V4_HTTP_PART_BYTES)
  const parts = Array.from({ length: count }, (_, index) => {
    const data = binary.subarray(index * V4_HTTP_PART_BYTES,
      (index + 1) * V4_HTTP_PART_BYTES)
    return { payloadSha256: f.manifest.payloadSha256, index, count,
      partSha256: sha(data), wirePartBytes: V4_HTTP_PART_BYTES, data }
  })
  return { ...f, parts, manifest: { ...f.manifest, count,
    wirePartBytes: V4_HTTP_PART_BYTES,
    partSha256s: parts.map(part => part.partSha256) } }
}
test('512-KiB raw HTTP parts use native binary Blob objects and restore', async () => {
  const f = binaryFixture(await fixture(1650 * 1024))
  assert.ok(f.parts.length >= 3)
  assert.equal(f.parts[0].data.length, V4_HTTP_PART_BYTES)
  await upload(f)
  const staging = [...f.raw.objects.entries()]
    .filter(([key]) => key.includes('/v4-http-parts/'))
  assert.equal(staging.length, f.parts.length)
  assert.ok(staging.every(([key, data]) => key.endsWith('.bin') &&
    data instanceof ArrayBuffer && data.byteLength > 0 &&
    data.byteLength <= V4_HTTP_PART_BYTES))
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
  const saved = await commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024)
  assert.equal(saved.revision, 1)
  assert.equal(sha(Buffer.from((await f.service.getSync(f.token)).payloadBase64,
    'base64')), f.manifest.payloadSha256)
  await upload(f)
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024), error =>
    error.code === 'sync_conflict' &&
    error.details.current.revision === 1)
})
test('binary part byte-limit, immutable SHA and missing native Blob object block commits', async () => {
  const f = binaryFixture(await fixture(460 * 1024))
  await assert.rejects(receiveV4UploadPart(f.storage, f.accountId,
    { ...f.parts[0], data: Buffer.alloc(V4_HTTP_PART_BYTES + 1) }),
  error => error.code === 'invalid_v4_upload_part')
  await assert.rejects(receiveV4UploadPart(f.storage, f.accountId,
    { ...f.parts[0], data: Buffer.from(f.parts[0].data).fill(13) }),
  error => error.code === 'v4_upload_part_sha_mismatch')
  await upload(f)
  const doomed = [...f.raw.objects.keys()].find(k =>
    k.includes('/v4-http-parts/v3/') && k.endsWith('.bin'))
  assert.ok(doomed)
  f.raw.objects.delete(doomed)
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
})
test('legacy V4 cloud revision migrates once to native binary without logical changes', async () => {
  const f = await fixture(270 * 1024)
  const oldPayload = f.parts.map(p => p.data).join('')
  const old = await f.service.putSyncV4(f.token, {
    ...f.manifest, payloadBase64: oldPayload,
  })
  assert.equal(old.revision, 1)
  assert.equal(old.storageEncoding, 'base64')
  const migrated = await f.service.migrateSyncV4Binary(f.token, {
    baseRevision: old.revision, payloadSha256: old.payloadSha256,
    logicalFingerprint: old.logicalFingerprint,
  })
  assert.equal(migrated.migrated, true)
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.storageEncoding, 'binary')
  const migratedRevision = [...f.raw.objects.entries()].find(([key]) =>
    key.includes('/revisions/') && key.endsWith('.json') &&
    key.includes(String(migrated.revision).padStart(12, '0')))
  assert.equal(migratedRevision?.[1]?.chunkedPayload?.version, 3)
  assert.equal(migratedRevision?.[1]?.chunkedPayload?.chunkBytes, 512 * 1024)
  assert.equal(migrated.payloadSha256, old.payloadSha256)
  assert.equal(migrated.logicalFingerprint, old.logicalFingerprint)
  const manifest = await f.service.getSyncV4BinaryManifest(f.token)
  const parts = []
  for (let index = 0; index < manifest.count; index++) {
    parts.push(await f.service.getSyncV4BinaryPart(f.token,
      manifest.revision, manifest.payloadSha256, index))
  }
  assert.equal(sha(Buffer.concat(parts)), old.payloadSha256)
  assert.equal((await f.service.migrateSyncV4Binary(f.token, {
    baseRevision: old.revision, payloadSha256: old.payloadSha256,
    logicalFingerprint: old.logicalFingerprint,
  })).migrated, false)
  assert.equal((await f.service.syncMeta(f.token)).revision, 2)
})
test('pinned binary download refuses stale revision and wrong full SHA', async () => {
  const f = binaryFixture(await fixture(470 * 1024))
  await upload(f)
  const meta = await commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024)
  await assert.rejects(f.service.getSyncV4BinaryPart(f.token,
    meta.revision - 1, meta.payloadSha256, 0), error =>
    error.code === 'sync_conflict')
  await assert.rejects(f.service.getSyncV4BinaryPart(f.token,
    meta.revision, 'f'.repeat(64), 0), error =>
    error.code === 'sync_conflict')
})
test('wrong pinned SHA cannot migrate existing Base64 V4 cloud or change revision', async () => {
  const f = await fixture(275 * 1024)
  const base64 = f.parts.map(part => part.data).join('')
  const previous = await f.service.putSyncV4(f.token, {
    ...f.manifest, payloadBase64: base64,
  })
  await assert.rejects(f.service.migrateSyncV4Binary(f.token, {
    baseRevision: previous.revision,
    payloadSha256: 'b'.repeat(64),
    logicalFingerprint: previous.logicalFingerprint,
  }), error => error.code === 'sync_conflict')
  assert.equal((await f.service.syncMeta(f.token)).revision, 1)
  assert.equal((await f.service.syncMeta(f.token)).storageEncoding, 'base64')
  assert.equal((await f.service.getSync(f.token)).payloadBase64, base64)
})
test('new binary final commit never stores Base64 in binary revision manifest', async () => {
  const f = binaryFixture(await fixture(350 * 1024))
  await upload(f)
  const meta = await commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024)
  assert.equal(meta.storageEncoding, 'binary')
  const manifests = [...f.raw.objects.entries()].filter(([key]) =>
    key.includes('/revisions/') && key.endsWith('.json'))
  assert.equal(manifests.length, 1)
  const manifest = manifests[0][1]
  assert.equal(manifest.payloadEncoding, 'binary')
  assert.equal(manifest.payloadBase64, undefined)
  assert.equal(manifest.chunkedPayload.version, 3)
  assert.equal(manifest.chunkedPayload.chunkBytes, 512 * 1024)
  assert.equal(manifest.chunkedPayload.count,
    Math.ceil(manifest.sizeBytes / (512 * 1024)))
  const revisions = [...f.raw.objects.entries()].filter(([key]) =>
    key.includes('/revision-parts/') && key.endsWith('.bin'))
  assert.equal(revisions.length, manifest.chunkedPayload.count)
  assert.ok(revisions.every(([, chunk]) => chunk instanceof ArrayBuffer))
})
test('master Base64 Backup V4 inline revision upgrades automatically into 512-KiB binary', async () => {
  const f = await fixture(30 * 1024)
  const originalBytes = Buffer.from(f.parts.map(p => p.data).join(''), 'base64')
  const old = await f.service.putSyncV4(f.token, {
    ...f.manifest, payloadBase64: originalBytes.toString('base64'),
  })
  assert.equal(old.storageEncoding, 'base64')
  const before = [...f.raw.objects.entries()].find(([key]) =>
    key.includes('/revisions/') && key.endsWith('.json'))?.[1]
  assert.equal(before?.payloadBase64, originalBytes.toString('base64'))
  assert.equal(before?.chunkedPayload, undefined)

  const upgraded = await f.service.migrateSyncV4Binary(f.token, {
    baseRevision: old.revision,
    payloadSha256: old.payloadSha256,
    logicalFingerprint: old.logicalFingerprint,
  })
  assert.equal(upgraded.revision, old.revision + 1)
  assert.equal(upgraded.payloadSha256, old.payloadSha256)
  assert.equal(upgraded.logicalFingerprint, old.logicalFingerprint)
  assert.equal(upgraded.storageEncoding, 'binary')
  const manifest = await f.service.getSyncV4BinaryManifest(f.token)
  assert.equal(manifest.chunkBytes, 512 * 1024)
  assert.equal(manifest.count, 1)
  assert.deepEqual(await f.service.getSyncV4BinaryPart(f.token, manifest.revision,
    manifest.payloadSha256, 0), originalBytes)
})

test('legacy JSON upload remains readable after binary protocol deployment', async () => {
  const f = await fixture()
  assert.equal(typeof f.parts[0].data, 'string')
  await upload(f)
  assert.equal((await commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024)).revision, 1)
})
async function upload(f) {
  for (const part of f.parts) {
    const accepted = await receiveV4UploadPart(f.storage, f.accountId, part)
    assert.equal(accepted.received, true)
  }
}
test('multi-request V4 stages without revision; commit verifies full six-table V4', async () => {
  const f = await fixture()
  assert.ok(f.parts.length > 1)
  await upload(f)
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
  const meta = await commitV4Upload(f.storage, f.service, f.token, f.accountId,
    f.manifest, 4 * 1024 * 1024)
  assert.equal(meta.revision, 1)
  assert.equal(meta.logicalFingerprint, f.manifest.logicalFingerprint)
  assert.equal((await f.service.getSync(f.token)).payloadBase64.length > 0, true)
  // Cleanup removes the staged parts; the same manifest cannot be reused.
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  // Re-staging identical immutable content reaches the original CAS gate.
  await upload(f)
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024),
  error => error.code === 'sync_conflict' &&
    error.details?.current?.revision === 1 &&
    error.details.failureStage === 'commit_core')
  assert.equal((await f.service.syncMeta(f.token)).revision, 1)
})
test('ambiguous immutable stage ACK, identical retry and account separation', async () => {
  const f = await fixture()
  f.raw.lostAck = true
  const a = await receiveV4UploadPart(f.storage, f.accountId, f.parts[0])
  assert.equal(a.received, true)
  assert.equal((await receiveV4UploadPart(f.storage, f.accountId,
    f.parts[0])).received, true)
  const differentAccount = 'not-' + f.accountId
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    differentAccount, f.manifest, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
})
test('tampering, absent parts and invalid SHA cannot publish a revision', async () => {
  const f = await fixture()
  await assert.rejects(receiveV4UploadPart(f.storage, f.accountId,
    { ...f.parts[0], data: f.parts[0].data.replace('A', 'B') }),
  error => error.code === 'v4_upload_part_sha_mismatch')
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, f.manifest, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  await upload(f)
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, { ...f.manifest, payloadSha256: 'a'.repeat(64) },
    4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, { ...f.manifest, partSha256s: ['c'.repeat(64),
      ...f.manifest.partSha256s.slice(1)] }, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible')
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
})
test('recovery cannot bypass server confirmation and stale base revision', async () => {
  const f = await fixture()
  await upload(f)
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token,
    f.accountId, { ...f.manifest, recoveryMode: 'replace-v4' },
    4 * 1024 * 1024, true), error =>
    error.code === 'recovery_precondition_failed' || error.code === 'sync_conflict')
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
})

test('successful part exposes server Blob write/readback latency without private keys', async () => {
  const f = await fixture()
  const reply = await receiveV4UploadPart(f.storage, f.accountId, f.parts[0])
  for (const name of ['blobWriteMs', 'blobReadbackMs', 'serverTotalMs']) {
    assert.ok(Number.isFinite(reply.timings[name]) && reply.timings[name] >= 0)
  }
  assert.ok(reply.timings.serverTotalMs >= reply.timings.blobWriteMs)
  assert.equal(JSON.stringify(reply.timings).includes(f.accountId), false)
})
test('server failure reports fixed Blob phase and timings, never internal errors', async () => {
  const f = await fixture()
  const failWrite = { putV4UploadPart: async () => { throw Error('secret storage location') },
    getV4UploadPart: f.storage.getV4UploadPart.bind(f.storage) }
  await assert.rejects(receiveV4UploadPart(failWrite, f.accountId, f.parts[0]),
    error => error.code === 'v4_upload_part_unverified' &&
      error.details.failureStage === 'blob_write' &&
      Number.isFinite(error.details.timings.blobWriteMs) &&
      !JSON.stringify(error.details).includes('secret'))
  const failRead = { putV4UploadPart: f.storage.putV4UploadPart.bind(f.storage),
    getV4UploadPart: async () => { throw Error('secret read location') } }
  await assert.rejects(receiveV4UploadPart(failRead, f.accountId, f.parts[0]),
    error => error.code === 'v4_upload_part_unverified' &&
      error.details.failureStage === 'blob_readback' &&
      Number.isFinite(error.details.timings.blobReadbackMs) &&
      !JSON.stringify(error.details).includes('secret'))
})
test('commit splits staged Blob reads, V4 core commit and cleanup durations', async () => {
  const f = await fixture()
  await upload(f)
  const reply = await commitV4Upload(f.storage, f.service, f.token, f.accountId,
    f.manifest, 4 * 1024 * 1024)
  assert.equal(reply.revision, 1)
  for (const name of ['partsReadMs', 'commitCoreMs', 'cleanupMs', 'serverTotalMs']) {
    assert.ok(Number.isFinite(reply.timings[name]) && reply.timings[name] >= 0)
  }
  assert.ok(reply.timings.serverTotalMs >= reply.timings.commitCoreMs)
  assert.ok(reply.timings.revisionChunkCount >= 1)
  for (const name of ['revisionWriteMs', 'revisionReadbackMs', 'revisionManifestMs']) {
    assert.ok(Number.isFinite(reply.timings[name]) && reply.timings[name] >= 0)
  }
  assert.equal(JSON.stringify(reply.timings).includes(f.accountId), false)
})
test('missing commit part carries part_lookup failure stage, no revision advance', async () => {
  const f = await fixture()
  await assert.rejects(commitV4Upload(f.storage, f.service, f.token, f.accountId,
    f.manifest, 4 * 1024 * 1024),
  error => error.code === 'v4_upload_part_not_visible' &&
    error.details.failureStage === 'part_lookup' &&
    Number.isFinite(error.details.timings.partsReadMs))
  assert.equal((await f.service.syncMeta(f.token)).revision, 0)
})
