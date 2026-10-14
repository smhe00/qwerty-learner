/* eslint-env node */
// Post-deployment V4 GA smoke: disposable test users ONLY, no real accounts.
// Never run against master until API health announces authenticated-write GA.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const base = new URL((process.env.QWERTY_SYNC_BASE_URL ||
  'https://qwerty-plus.edgeone.dev/').trim())
const users = []
let failure
const prefix = 'v4_ga_' + Date.now().toString(36) +
  crypto.randomBytes(3).toString('hex')
const sha256 = content => crypto.createHash('sha256').update(content).digest('hex')
const requireGzip = bytes => gunzipSync(bytes).toString('utf8')
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function api(path, method = 'GET', body, token) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, base), {
    method, headers, body: body === undefined ? undefined :
      typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  // Preserve redacted diagnostics when a large 200 response is malformed.
  // Never print or persist a user's Base64 snapshot.
  const text = await response.text()
  let value = null
  let parseFailure = null
  try { value = JSON.parse(text) } catch (error) {
    parseFailure = error instanceof Error ? error.name : 'parse_error'
  }
  return { status: response.status, value, responseBytes: Buffer.byteLength(text),
    declaredBytes: response.headers.get('content-length'), parseFailure }
}
function expectCode(result, status, code, label) {
  assert.equal(result.status, status,
    label + ': unexpected HTTP ' + result.status +
    ', error=' + (result.value?.error || 'unknown'))
  if (code) assert.equal(result.value?.error, code, label + ': error code')
}
async function register(suffix) {
  const user = {
    username: prefix + '_' + suffix,
    password: crypto.randomBytes(18).toString('base64url'),
  }
  const result = await api('/api/auth/register', 'POST', {
    ...user, deviceId: 'v4-ga-disposable-' + suffix,
  })
  expectCode(result, 201, null, 'register ' + suffix)
  user.userId = result.value?.user?.userId
  user.token = result.value?.token
  assert.ok(user.userId && user.token)
  users.push(user)
  return user
}
function v4Body(user, revision, nonce) {
  const tableNames = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = tableNames.map(name => ({ name, schema: '++id' }))
  const data = tableNames.map(name => ({
    tableName: name, inbound: true,
    rows: name === 'wordRecords' ? [{ id: 1, word: 'ga-smoke-' + nonce }] : [],
  }))
  const workspaceData = {
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6, tables, data,
    } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'ga-smoke-dict', currentChapter: 0 },
  }
  const logical = {
    database: { tables, data }, learnRuntime: workspaceData.learnRuntime,
    settings: workspaceData.settings, navigation: workspaceData.navigation,
  }
  const logicalFingerprint = sha256(stable(logical))
  const snapshot = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-11T00:00:00.000Z',
      source: { kind: 'account', accountId: user.userId } },
    workspaceData,
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  // Ensure our disposable file satisfies *real* V4 server contract.
  assert.equal(verifyCompressedV4(gz, user.userId, logicalFingerprint).logicalFingerprint,
    logicalFingerprint)
  return {
    baseRevision: revision, payloadBase64: gz.toString('base64'),
    logicalFingerprint, clientFormatVersion: 'qwerty-backup-v4',
    deviceId: 'v4-ga-disposable',
  }
}
function v4BodyFromSnapshot(user, revision, snapshot) {
  const data = snapshot.workspaceData
  const logicalFingerprint = sha256(stable({
    database: { tables: data.database.data.tables, data: data.database.data.data },
    learnRuntime: data.learnRuntime, settings: data.settings,
    navigation: data.navigation,
  }))
  const zip = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  assert.equal(verifyCompressedV4(zip, user.userId, logicalFingerprint).logicalFingerprint,
    logicalFingerprint)
  return { baseRevision: revision, payloadBase64: zip.toString('base64'),
    logicalFingerprint, clientFormatVersion: 'qwerty-backup-v4',
    deviceId: 'beta-v4-native-blob-test' }
}

// Native binary readback is pinned to revision+SHA. Never use the legacy
// JSON/Base64 GET for the new binary V4 storage layout.
async function getBinaryV4(token, expected) {
  const manifest = await api('/api/sync/v2/binary/manifest', 'GET', undefined, token)
  expectCode(manifest, 200, null, 'binary V4 manifest')
  assert.equal(manifest.value?.revision, expected.revision)
  assert.equal(manifest.value?.payloadSha256, expected.payloadSha256)
  assert.equal(manifest.value?.payloadEncoding, 'binary')
  assert.ok(Number.isSafeInteger(manifest.value?.count) &&
    manifest.value.count >= 1 && manifest.value.count <= 64)
  assert.equal(manifest.value.partSha256s?.length, manifest.value.count)
  const parts = []
  let size = 0
  for (let index = 0; index < manifest.value.count; index++) {
    const selector = new URLSearchParams({
      revision: String(manifest.value.revision),
      sha: manifest.value.payloadSha256, index: String(index),
    })
    const res = await fetch(new URL('/api/sync/v2/binary/part?' + selector, base), {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
    assert.equal(res.status, 200, 'binary GET part HTTP')
    const part = Buffer.from(await res.arrayBuffer())
    assert.ok(part.length > 0 && part.length <= 192 * 1024)
    assert.equal(sha256(part), manifest.value.partSha256s[index],
      'binary GET immutable part SHA')
    size += part.length
    parts.push(part)
  }
  assert.equal(size, manifest.value.sizeBytes, 'binary GET full byte length')
  const payload = Buffer.concat(parts)
  assert.equal(sha256(payload), manifest.value.payloadSha256,
    'binary GET full SHA')
  return payload
}

// Native 192-KiB BINARY multipart route; test against REAL EdgeOne, not in-memory Blob.
async function apiBinaryPart(data, token, payloadSha256, partSha256, index, count) {
  const response = await fetch(new URL('/api/sync/v2/parts', base), {
    method: 'POST', headers: {
      Accept: 'application/json', Authorization: 'Bearer ' + token,
      'Content-Type': 'application/octet-stream',
      'X-Qwerty-Payload-Sha256': payloadSha256,
      'X-Qwerty-Part-Sha256': partSha256,
      'X-Qwerty-Part-Index': String(index),
      'X-Qwerty-Part-Count': String(count),
    }, body: data, redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let value = null
  try { value = JSON.parse(text) } catch { /* Redacted invalid ACK below. */ }
  return { status: response.status, value,
    responseBytes: Buffer.byteLength(text) }
}
// A part may be retried identically, but ambiguous final revision MUST
// be checked by GET meta and never blindly overwritten.
async function uploadLargeV4(record, token) {
  const raw = Buffer.from(record.payloadBase64, 'base64')
  const payloadSha256 = sha256(raw)
  const bytesPerPart = 192 * 1024
  const count = Math.ceil(raw.length / bytesPerPart)
  assert.ok(count >= 1 && count <= 192)
  const partSha256s = []
  const uploadStarted = performance.now()
  let partHttpMs = 0
  let partServerMs = 0
  let partBlobWriteMs = 0
  let slowestPart = { index: -1, elapsedMs: 0 }
  for (let index = 0; index < count; index++) {
    const data = raw.subarray(index * bytesPerPart, (index + 1) * bytesPerPart)
    const partSha256 = sha256(data)
    partSha256s.push(partSha256)
    // Only retry the exact immutable part; never retry an ambiguous
    // final /commit. Verify Maker's real 192-KiB raw-body behavior.
    let staged
    for (let attempt = 0; attempt < 6; attempt++) {

      const started = performance.now()
      try {
        staged = await apiBinaryPart(data, token, payloadSha256, partSha256,
          index, count)
      } catch (error) {
        const elapsedMs = Math.round(performance.now() - started)
        console.error('V4 part attempt failed', JSON.stringify({
          partIndex: index, count, attempt: attempt + 1, elapsedMs,
          failureStage: 'http_request',
          failureCategory: error?.name === 'TimeoutError' ||
            error?.name === 'AbortError' ? 'network_timeout' : 'network_failure',
        }))
        if (attempt === 5) throw error
        staged = { status: 503, value: { error: 'network_error' } }
      }
      const elapsedMs = Math.round(performance.now() - started)
      partHttpMs += elapsedMs
      const server = staged.value?.timings || staged.value?.details?.timings || {}
      partServerMs += server.serverTotalMs || 0
      partBlobWriteMs += server.blobWriteMs || 0
      if (elapsedMs > slowestPart.elapsedMs) slowestPart = { index, elapsedMs }
      if (elapsedMs >= 1500 || staged.status !== 200 || index % 8 === 0) {
        console.log('V4 part stage', JSON.stringify({
          partIndex: index, count, attempt: attempt + 1, elapsedMs,
          status: staged.status, code: staged.value?.error || null,
          failureStage: staged.value?.details?.failureStage || null,
          serverTotalMs: server.serverTotalMs ?? null,
          blobWriteMs: server.blobWriteMs ?? null,
          blobReadbackMs: server.blobReadbackMs ?? null,
        }))
      }
      if (staged.status === 200) break
      if (staged.status < 500 || staged.status > 599 || attempt === 5) break
      await new Promise(resolve => setTimeout(resolve,
        [0, 150, 350, 750, 1500, 3000][attempt + 1]))
    }
    expectCode(staged, 200, null, 'immutable multipart upload ' + index)
    assert.equal(staged.value?.received, true)
    assert.equal(staged.value?.payloadSha256, payloadSha256)
    assert.equal(staged.value?.index, index)
    assert.equal(staged.value?.partSha256, partSha256)
  }
  const meta = { ...record }
  delete meta.payloadBase64

  const commitStarted = performance.now()
  try {
    const reply = await api('/api/sync/v2/commit', 'POST', {
      ...meta, payloadSha256, count, partSha256s,
    }, token)
    console.log('V4 transport timing', JSON.stringify({
      count, totalMs: Math.round(performance.now() - uploadStarted),
      partsHttpMs: Math.round(partHttpMs),
      partsServerMs: Math.round(partServerMs),
      partsBlobWriteMs: Math.round(partBlobWriteMs),
      slowestPart,
      commitHttpMs: Math.round(performance.now() - commitStarted),
      commitStatus: reply.status, commitCode: reply.value?.error || null,
      commitFailureStage: reply.value?.details?.failureStage || null,
      commitServer: reply.value?.timings || reply.value?.details?.timings || null,
    }))
    return reply
  } catch (error) {
    console.error('V4 commit attempt failed', JSON.stringify({
      count, partsHttpMs: Math.round(partHttpMs),
      partsServerMs: Math.round(partServerMs),
      slowestPart, commitHttpMs: Math.round(performance.now() - commitStarted),
      failureCategory: error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ? 'network_timeout' : 'network_failure',
    }))
    throw error
  }
}

try {
  const health = await api('/api/health')
  expectCode(health, 200, null, 'EdgeOne gateway health')
  assert.equal(health.value?.service, 'qwerty-sync-gateway')
  assert.ok(health.value?.capabilities?.includes('backup-v4-authenticated-write-ga'),
    'Production has not deployed the V4 GA API; do not write')
  assert.ok(health.value?.capabilities?.includes('v4-http-stage-trace-v1'),
    'Maker stage timing capability not deployed; do not infer bottlenecks')
  assert.ok(health.value?.capabilities?.includes('v4-end-to-end-binary-v1'),
    'Native Blob persistence + download protocol not deployed; refuse real upload')
  console.log('V4 GA deployed backend capability: PASS')

  expectCode(await api('/api/sync/v2', 'PUT', '{}'), 401,
    'missing_token', 'anonymous V4 PUT')
  console.log('Anonymous V4 write rejection: PASS')

  const first = await register('first')
  const second = await register('second')

  const m0 = await api('/api/sync/v2/meta', 'GET', undefined, first.token)
  assert.equal(m0.value?.revision, 0)
  const firstPush = await api('/api/sync/v2', 'PUT', v4Body(first, 0, 'one'),
    first.token)
  expectCode(firstPush, 200, null, 'GA first V4 upload')
  assert.equal(firstPush.value?.revision, 1)
  const secondPush = await api('/api/sync/v2', 'PUT', v4Body(first, 1, 'two'),
    first.token)
  expectCode(secondPush, 200, null, 'GA subsequent V4 upload')
  assert.equal(secondPush.value?.revision, 2)
  const stale = await api('/api/sync/v2', 'PUT', v4Body(first, 1, 'stale'),
    first.token)
  expectCode(stale, 409, 'sync_conflict', 'GA stale revision CAS')
  console.log('Fresh V4 and stale revision protection: PASS')

  assert.equal((await api('/api/sync/v2/meta', 'GET', undefined, second.token)).value?.revision, 0)
  const secondOwn = await api('/api/sync/v2', 'PUT', v4Body(second, 0, 'other-account'),
    second.token)
  expectCode(secondOwn, 200, null, 'second normal user without allowlist')
  assert.equal(secondOwn.value?.revision, 1)
  assert.equal((await api('/api/sync/v2/meta', 'GET', undefined, first.token)).value?.revision, 2)
  console.log('Second unlisted account independent V4 write: PASS')

  // One-click migration of an existing Base64 cloud revision is a separate
  // storage-only CAS step. It must preserve the exact gzip SHA and the
  // learning-state logical fingerprint, then become idempotent. All accounts
  // here are disposable; never migrate a real user's account from CI.
  const oldSecond = await api('/api/sync/v2/meta', 'GET', undefined, second.token)
  assert.equal(oldSecond.value?.storageEncoding, 'base64')
  const pinnedOld = {
    baseRevision: oldSecond.value.revision,
    payloadSha256: oldSecond.value.payloadSha256,
    logicalFingerprint: oldSecond.value.logicalFingerprint,
  }
  const migrated = await api('/api/sync/v2/binary/migrate', 'POST',
    pinnedOld, second.token)
  expectCode(migrated, 200, null, 'legacy V4 to binary migration')
  assert.equal(migrated.value?.storageEncoding, 'binary')
  assert.equal(migrated.value?.revision, oldSecond.value.revision + 1)
  assert.equal(migrated.value?.payloadSha256, oldSecond.value.payloadSha256)
  assert.equal(migrated.value?.logicalFingerprint, oldSecond.value.logicalFingerprint)
  const migratedBytes = await getBinaryV4(second.token, migrated.value)
  assert.deepEqual(migratedBytes,
    Buffer.from(v4Body(second, 0, 'other-account').payloadBase64, 'base64'),
    'migration must preserve byte-exact V4 gzip')
  const again = await api('/api/sync/v2/binary/migrate', 'POST',
    pinnedOld, second.token)
  expectCode(again, 200, null, 'idempotent second binary migration')
  assert.equal(again.value?.migrated, false)
  assert.equal(again.value?.revision, migrated.value.revision)
  console.log('Existing V4 one-action binary migration, SHA and idempotence: PASS')

  // V4-only stress: exercise real Blob upload at a size comparable to the
  // intermittent production recovery failures, without creating V3 records.
  // A transport 500 may be ambiguous; inspect remote metadata READ-ONLY
  // and fail rather than retry a potentially committed revision.
  const stressKiB = [256, 512, 1024, 1536, 2048, 2700]
  for (let index = 0; index < stressKiB.length; index++) {
    const baseRevision = index + 2
    const record = v4Body(first, baseRevision, 'large-' + index)
    const compressed = Buffer.from(record.payloadBase64, 'base64')
    const largeState = JSON.parse(requireGzip(compressed))
    largeState.workspaceData.database.data.data
      .find(table => table.tableName === 'wordRecords').rows[0]
      .typingTelemetry = { synthetic: crypto.randomBytes(stressKiB[index] * 1024).toString('base64') }
    const largeBody = v4BodyFromSnapshot(first, baseRevision, largeState)
    const sent = await uploadLargeV4(largeBody, first.token)
    const latest = await api('/api/sync/v2/meta', 'GET', undefined, first.token)
    console.log('V4-only large Blob write', JSON.stringify({ attempt: index + 1,
      sourceKiB: stressKiB[index],
      requestBytes: Buffer.from(largeBody.payloadBase64, 'base64').length,
      status: sent.status, code: sent.value?.error || null,
      stage: sent.value?.details?.stage || null,
      partIndex: sent.value?.details?.partIndex ?? null,
      observedRevision: latest.value?.revision ?? null,
      observedFormat: latest.value?.clientFormatVersion ?? null }))
    assert.equal(latest.status, 200, 'read-only post-write verification')
    assert.equal(sent.status, 200, 'multipart large V4 write HTTP result')
    assert.equal(latest.value?.revision, baseRevision + 1)
    assert.equal(latest.value?.clientFormatVersion, 'qwerty-backup-v4')
    assert.equal(latest.value?.logicalFingerprint, largeBody.logicalFingerprint)
    assert.equal(latest.value?.payloadSha256,
      sha256(Buffer.from(largeBody.payloadBase64, 'base64')))
    // Metadata alone is insufficient. Read EACH actual native Blob chunk
    // through the authenticated binary endpoint and verify the whole gzip SHA.
    assert.equal(latest.value?.storageEncoding, 'binary')
    const restored = await getBinaryV4(first.token, latest.value)
    assert.deepEqual(restored, Buffer.from(largeBody.payloadBase64, 'base64'),
      'binary V4 GET round-trip must be byte-exact')
  }
  console.log('V4 HTTP multipart large-payload endurance: PASS')
} catch (error) {
  failure = error
} finally {
  for (const user of users.reverse()) {
    try {
      const deleted = await api('/api/auth/account', 'DELETE',
        { currentPassword: user.password }, user.token)
      expectCode(deleted, 200, null, 'disposable cleanup ' + user.username)
      assert.equal(deleted.value?.deleted?.accountDeleted, true)
      console.log('Disposable account cleanup: PASS')
    } catch (error) {
      console.error('Disposable account cleanup FAILED (no credentials printed)')
      failure ||= error
    }
  }
}
if (failure) throw failure
