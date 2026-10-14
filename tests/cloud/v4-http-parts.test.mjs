/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import {
  V4_HTTP_PART_CHARS, commitV4Upload, receiveV4UploadPart,
} from '../../cloud-functions/_shared/v4-http-parts.js'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const sha = data => crypto.createHash('sha256').update(data).digest('hex')
const clone = value => value === null ? null : structuredClone(value)
class Blob {
  constructor() { this.objects = new Map(); this.lostAck = false }
  async get(key) { return this.objects.has(key) ? clone(this.objects.get(key)) : null }
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
async function fixture() {
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
      typingTelemetry: { synthetic: crypto.randomBytes(180 * 1024).toString('base64') },
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
