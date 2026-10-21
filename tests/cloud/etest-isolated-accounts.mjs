/* eslint-env node */
/**
 * Isolated-account REAL EdgeOne E2E: three disposable accounts, no personal
 * data and NO cross-account import. Runs only for edgeone-test exact SHA.
 *
 * Proves that one user's V4 Blob updates never mutate another user's
 * revision, forged owners are rejected and deletion is scoped.
 * Multi-device SAME ACCOUNT FSRS convergence is tested separately.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
const origin = new URL(process.env.QWERTY_SYNC_BASE_URL || '')
assert.equal(origin.origin, 'https://etest.edgeone.dev')
assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
const prefix = 'isov4_' + process.env.GITHUB_RUN_ID + '_' +
  (process.env.GITHUB_RUN_ATTEMPT || '1')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const users = []
let failure
const names = ['achievementEvents', 'achievementStates', 'chapterRecords',
  'reviewRecords', 'reviewWordStates', 'wordRecords']

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
}
async function api(path, method = 'GET', body, token, extra = {}) {
  const headers = { Accept: 'application/json', ...extra }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, origin), {
    method, headers,
    body: body === undefined ? undefined : Buffer.isBuffer(body) ?
      body : JSON.stringify(body),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
  })
  let value
  try { value = JSON.parse(await response.text()) } catch { value = null }
  return { status: response.status, value }
}
function ok(result, status, name) {
  assert.equal(result.status, status, name + ': HTTP ' + result.status +
    ' ' + (result.value?.error || 'unknown'))
  return result.value
}
function snapshotFor(accountId, label) {
  const tables = names.map(name => ({ name, schema: '++id' }))
  const data = names.map(tableName => ({ tableName, inbound: true,
    rows: tableName === 'wordRecords' ? [
      { id: 1, dict: 'isolated-test', word: label, timeStamp: 1800000000 },
    ] : [] }))
  const workspaceData = {
    database: { formatName: 'dexie', formatVersion: 1,
      data: { databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'isolated-test', currentChapter: 0 },
  }
  const logicalFingerprint = sha(stable({
    database: { tables, data },
    learnRuntime: workspaceData.learnRuntime,
    settings: workspaceData.settings,
    navigation: workspaceData.navigation,
  }))
  const snap = { backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-22T00:00:00.000Z',
      source: { kind: 'account', accountId } },
    workspaceData }
  const bytes = gzipSync(Buffer.from(JSON.stringify(snap)))
  assert.equal(verifyCompressedV4(bytes, accountId, logicalFingerprint)
    .logicalFingerprint, logicalFingerprint)
  assert.ok(bytes.length < 512 * 1024)
  return { bytes, logicalFingerprint }
}
async function upload(user, owner = user.userId, label = 'origin') {
  const record = snapshotFor(owner, label)
  const result = await api('/api/sync/v2/binary/direct', 'POST',
    record.bytes, user.token, {
      'Content-Type': 'application/octet-stream',
      'X-Qwerty-Payload-Sha256': sha(record.bytes),
      'X-Qwerty-Base-Revision': '0',
      'X-Qwerty-Logical-Fingerprint': record.logicalFingerprint,
    })
  return { ...result, record }
}
async function meta(user) {
  return ok(await api('/api/sync/v2/meta', 'GET', undefined, user.token),
    200, 'V4 account meta')
}
async function register(suffix) {
  const user = { username: prefix + '_' + suffix,
    password: 'E2E-' + crypto.randomBytes(15).toString('hex') }
  const response = ok(await api('/api/auth/register', 'POST', {
    username: user.username, password: user.password,
    deviceId: 'qwerty-web-' + crypto.randomUUID(),
  }), 201, 'disposable register')
  user.token = response.token
  user.userId = response.user.userId
  assert.ok(user.token && user.userId)
  users.push(user)
  return user
}

try {
  const health = ok(await api('/api/health'), 200, 'isolated EdgeOne health')
  assert.equal(health.service, 'qwerty-sync-gateway')
  const initial = await Promise.all(['a', 'b', 'c'].map(register))
  const [a, b, c] = initial
  assert.equal(new Set(initial.map(x => x.userId)).size, 3)
  for (const u of initial) {
    const who = ok(await api('/api/auth/me', 'GET', undefined, u.token),
      200, 'authenticated principal')
    assert.equal(who.user.userId, u.userId)
    assert.equal((await meta(u)).revision, 0)
  }
  const writtenA = await upload(a, a.userId, 'account-A-only')
  ok(writtenA, 200, 'A native V4 upload')
  assert.equal(writtenA.value.revision, 1)
  assert.equal((await meta(a)).logicalFingerprint,
    writtenA.record.logicalFingerprint)
  assert.equal((await meta(b)).revision, 0)
  assert.equal((await meta(c)).revision, 0)
  // A bearer from B cannot upload a V4 snapshot owned by A, even though it
  // has all A's public immutable account ID data.
  const forged = await upload(b, a.userId, 'forged-A')
  assert.notEqual(forged.status, 200, 'foreign V4 owner must be rejected')
  assert.ok([400, 403, 409, 422].includes(forged.status))
  assert.equal((await meta(b)).revision, 0)
  assert.equal((await meta(a)).logicalFingerprint,
    writtenA.record.logicalFingerprint)

  const writtenB = await upload(b, b.userId, 'account-B-only')
  ok(writtenB, 200, 'B native V4 upload')
  assert.equal(writtenB.value.revision, 1)
  assert.notEqual(writtenA.record.logicalFingerprint,
    writtenB.record.logicalFingerprint)
  assert.equal((await meta(a)).logicalFingerprint,
    writtenA.record.logicalFingerprint)
  assert.equal((await meta(b)).logicalFingerprint,
    writtenB.record.logicalFingerprint)
  assert.equal((await meta(c)).revision, 0)

  const deleted = ok(await api('/api/auth/account', 'DELETE',
    { currentPassword: b.password }, b.token), 200, 'B scoped deletion')
  assert.equal(deleted.deleted.accountDeleted, true)
  users.splice(users.indexOf(b), 1)
  assert.equal((await meta(a)).logicalFingerprint,
    writtenA.record.logicalFingerprint)
  assert.equal((await meta(c)).revision, 0)
  console.log('PASS: 3 accounts; forged V4 refused; isolated revision, deletion and owner SHA; M4 unactivated')
} catch (error) {
  failure = error
} finally {
  for (const user of users.reverse()) {
    try {
      const result = await api('/api/auth/account', 'DELETE',
        { currentPassword: user.password }, user.token)
      assert.equal(result.status, 200, 'disposable account cleanup HTTP')
      assert.equal(result.value?.deleted?.accountDeleted, true)
    } catch (error) {
      console.error('FAILED cleanup for disposable isolated-account fixture')
      failure ||= error
    }
  }
}
if (failure) throw failure
