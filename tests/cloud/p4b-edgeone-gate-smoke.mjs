/* eslint-env node */
// Post-deployment V4 GA smoke: disposable test users ONLY, no real accounts.
// Never run against master until API health announces authenticated-write GA.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const base = new URL((process.env.QWERTY_SYNC_BASE_URL ||
  'https://qwerty-plus.edgeone.dev/').trim())
const users = []
let failure
const prefix = 'v4_ga_' + Date.now().toString(36) +
  crypto.randomBytes(3).toString('hex')
const sha256 = content => crypto.createHash('sha256').update(content).digest('hex')
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
  const value = await response.json().catch(() => null)
  return { status: response.status, value }
}
function expectCode(result, status, code, label) {
  assert.equal(result.status, status,
    label + ': unexpected HTTP status ' + result.status)
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
try {
  const health = await api('/api/health')
  expectCode(health, 200, null, 'EdgeOne gateway health')
  assert.equal(health.value?.service, 'qwerty-sync-gateway')
  assert.ok(health.value?.capabilities?.includes('backup-v4-authenticated-write-ga'),
    'Production has not deployed the V4 GA API; do not write')
  console.log('V4 GA deployed backend capability: PASS')

  expectCode(await api('/api/sync/v2', 'PUT', '{}'), 401,
    'missing_token', 'anonymous V4 PUT')
  console.log('Anonymous V4 write rejection: PASS')

  const first = await register('first')
  const second = await register('second')
  const legacy = await register('v3')

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
  const oldClient = await api('/api/sync', 'PUT', {
    baseRevision: 2,
    payloadBase64: gzipSync(Buffer.from(JSON.stringify({ legacy: true }))).toString('base64'),
    clientFormatVersion: 'qwerty-backup-v3',
    deviceId: 'legacy-attempt',
  }, first.token)
  expectCode(oldClient, 409, 'sync_upgrade_required', 'V1 downgrade protection')
  console.log('Fresh V4 and subsequent CAS/V1 downgrade: PASS')

  assert.equal((await api('/api/sync/v2/meta', 'GET', undefined, second.token)).value?.revision, 0)
  const secondOwn = await api('/api/sync/v2', 'PUT', v4Body(second, 0, 'other-account'),
    second.token)
  expectCode(secondOwn, 200, null, 'second normal user without allowlist')
  assert.equal(secondOwn.value?.revision, 1)
  assert.equal((await api('/api/sync/v2/meta', 'GET', undefined, first.token)).value?.revision, 2)
  console.log('Second unlisted account independent V4 write: PASS')

  const historical = await api('/api/sync', 'PUT', {
    baseRevision: 0,
    payloadBase64: gzipSync(Buffer.from(JSON.stringify({ oldData: true }))).toString('base64'),
    clientFormatVersion: 'qwerty-backup-v3',
    deviceId: 'v3-disposable',
  }, legacy.token)
  expectCode(historical, 200, null, 'disposable historical V3')
  assert.equal(historical.value?.revision, 1)
  const noAutoMigration = await api('/api/sync/v2', 'PUT',
    v4Body(legacy, 1, 'reject-auto-migration'), legacy.token)
  // Even a 500 must not be assumed safe: read back metadata before any retry.
  // This is a redacted status-only diagnostic; no credentials or payloads.
  const legacyMeta = await api('/api/sync/v2/meta', 'GET', undefined, legacy.token)
  console.log('V3-to-V4 refused-write evidence', JSON.stringify({
    putStatus: noAutoMigration.status,
    putCode: noAutoMigration.value?.error || null,
    metaStatus: legacyMeta.status,
    remoteRevision: legacyMeta.value?.revision ?? null,
    remoteFormat: legacyMeta.value?.clientFormatVersion ?? null,
  }))
  assert.equal(legacyMeta.status, 200, 'read-only verification after refused write')
  assert.equal(legacyMeta.value?.revision, 1, 'failed ordinary V4 PUT must not advance V3 revision')
  assert.equal(legacyMeta.value?.clientFormatVersion, 'qwerty-backup-v3',
    'failed ordinary V4 PUT must not change remote format')
  expectCode(noAutoMigration, 409, 'sync_migration_required',
    'Existing V3 cannot be overwritten by normal V4 Sync')
  console.log('Existing V3 remains V3; no automatic migration: PASS')
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
