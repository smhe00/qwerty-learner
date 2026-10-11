/* eslint-env node */
/**
 * Incident P0: disposable production V3 -> explicit V4 recovery only.
 * Never mutates an existing account. No credentials/payload in CI logs.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const base = new URL((process.env.QWERTY_SYNC_BASE_URL ||
  'https://qwerty-plus.edgeone.dev/').trim())
const user = { username: 'v4r_' + Date.now().toString(36) +
  crypto.randomBytes(3).toString('hex'), password: crypto.randomBytes(24).toString('base64url'),
  token: null, userId: null }
let created = false
let failure = null
function hex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function api(path, method = 'GET', body, token = user.token) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, base), {
    method, headers,
    body: body === undefined ? undefined :
      typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  const parsed = await response.json().catch(() => null)
  return { status: response.status, value: parsed }
}
function summary(label, response) {
  // Safe classification only: never print payloads, auth or opaque request bodies.
  console.log(label, JSON.stringify({ status: response.status,
    code: response.value?.error || null,
    message: typeof response.value?.message === 'string'
      ? response.value.message.slice(0, 110) : null,
    revision: Number.isSafeInteger(response.value?.revision)
      ? response.value.revision : null,
    format: response.value?.clientFormatVersion || null,
  }))
}
function v4Body(baseRevision, remote) {
  const tableNames = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = tableNames.map(name => ({ name, schema: '++id' }))
  const data = tableNames.map(name => ({
    tableName: name, inbound: true,
    rows: name === 'wordRecords' ? [{ id: 1, word: 'disposable-v4' }] : [],
  }))
  const workspaceData = {
    database: { formatName: 'dexie', formatVersion: 1,
      data: { databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
    settings: { version: 1, values: {} },
    learnRuntime: { dailySessions: {} },
    navigation: { currentDict: 'disposable', currentChapter: 0 },
  }
  const candidate = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-11T00:00:00Z',
      source: { kind: 'account', accountId: user.userId } },
    workspaceData,
  }
  const canonical = { database: { tables, data },
    settings: workspaceData.settings, learnRuntime: workspaceData.learnRuntime,
    navigation: workspaceData.navigation }
  const logicalFingerprint = hex(stable(canonical))
  const gz = gzipSync(Buffer.from(JSON.stringify(candidate)))
  assert.equal(verifyCompressedV4(gz, user.userId, logicalFingerprint).logicalFingerprint,
    logicalFingerprint)
  return {
    baseRevision,
    payloadBase64: gz.toString('base64'),
    logicalFingerprint, clientFormatVersion: 'qwerty-backup-v4',
    recoveryMode: 'migrate-v3', expectedRemoteFormat: 'qwerty-backup-v3',
    expectedRemoteSha256: remote.payloadSha256,
    accountConfirmation: user.userId,
    deviceId: 'synthetic-v4-recovery-incident',
  }
}

try {
  const health = await api('/api/health', 'GET', undefined, null)
  summary('Health', health)
  assert.equal(health.status, 200)
  assert.equal(health.value?.service, 'qwerty-sync-gateway')
  assert.ok(health.value?.capabilities?.includes('backup-v4-authenticated-write-ga'),
    'Production GA backend absent; no account creation or mutation performed')
  const registered = await api('/api/auth/register', 'POST', {
    username: user.username, password: user.password,
    deviceId: 'isolated-recovery-incident',
  }, null)
  summary('Temporary account registration', registered)
  if (registered.status === 201 && registered.value?.token) {
    created = true
    user.token = registered.value.token
    user.userId = registered.value.user?.userId
  }
  assert.equal(registered.status, 201)
  assert.ok(user.userId)
  const oldPayload = gzipSync(Buffer.from(JSON.stringify({ backup: 'V3 synthetic' })))
  const legacy = await api('/api/sync', 'PUT', {
    baseRevision: 0,
    payloadBase64: oldPayload.toString('base64'),
    deviceId: 'synthetic-v3-seed',
    clientFormatVersion: 'qwerty-backup-v3',
  })
  summary('Temporary V3 seed', legacy)
  assert.equal(legacy.status, 200)
  assert.equal(legacy.value?.revision, 1)
  const pinned = await api('/api/sync/v2/meta')
  summary('Read-only V3 pinned metadata', pinned)
  assert.equal(pinned.value?.revision, 1)
  assert.equal(pinned.value?.clientFormatVersion, 'qwerty-backup-v3')
  assert.equal(pinned.value?.payloadSha256, hex(oldPayload))
  const put = await api('/api/sync/v2/recovery', 'PUT', v4Body(1, pinned.value))
  summary('Explicit V3 to V4 recovery', put)
  // Even on 500/timeout, first perform only a read-only metadata recheck.
  const latest = await api('/api/sync/v2/meta')
  summary('Read-only result after recovery attempt', latest)
  assert.equal(put.status, 200,
    'Recovery endpoint failed in synthetic production environment')
  assert.equal(latest.value?.revision, 2)
  assert.equal(latest.value?.clientFormatVersion, 'qwerty-backup-v4')
  console.log('PRODUCTION DISPOSABLE V4 EXPLICIT RECOVERY PASS')
} catch (error) {
  failure = error
  console.error('PRODUCTION DISPOSABLE V4 EXPLICIT RECOVERY FAILED:',
    error instanceof Error ? error.message : 'unknown error')
} finally {
  if (created && user.token) {
    try {
      const deleted = await api('/api/auth/account', 'DELETE',
        { currentPassword: user.password })
      assert.equal(deleted.status, 200)
      assert.equal(deleted.value?.deleted?.accountDeleted, true)
      console.log('Synthetic account and revisions cleaned: PASS')
    } catch (error) {
      console.error('Synthetic cleanup FAILED: manual review required')
      failure ||= error
    }
  }
}
if (failure) throw failure
