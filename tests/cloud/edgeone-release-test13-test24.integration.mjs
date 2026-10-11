/* eslint-env node */
// Post-release Qwerty Plus production Maker+Blob V4 validation, test13/test24 only.
// No Maker deployment or account credentials printed; never touch existing identities.
// Existing usernames will NOT be taken over or deleted.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

const base = new URL(process.env.QWERTY_SYNC_BASE_URL || 'https://qwerty-plus.edgeone.dev/')
const NAMES = ['test13', 'test24']
const secrets = new Map()
const active = new Map()
const created = new Set()
const TABLES = ['achievementEvents', 'achievementStates', 'chapterRecords',
  'reviewRecords', 'reviewWordStates', 'wordRecords']
const EXPECTED_FRONTEND_MARKER = 'perf-report'
let firstError = null
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')
const stable = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
}
function assertStatus(response, code, context) {
  assert.equal(response.status, code, context + ' returned HTTP ' + response.status +
    ', error code ' + String(response.json?.error || '(none)') +
    ', server diagnostic ' + String(response.json?.debugType || '(none)') +
    ': ' + String(response.json?.debugMessage || '(none)'))
}
async function api(path, { method = 'GET', user = null, token = null, body } = {}) {
  const headers = { Accept: 'application/json' }
  const authorization = token || (user && active.get(user)?.token)
  if (authorization) headers.Authorization = 'Bearer ' + authorization
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, base), {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  let json
  try { json = await response.json() }
  catch { throw new Error(method + ' ' + path + ' returned HTTP ' + response.status + ' non-JSON') }
  return { status: response.status, json }
}
async function pollDeployment() {
  // The Git pointer changes before EdgeOne Maker finishes building.
  // The performance release introduced a perf-report route missing in the
  // previously published client. Require health AND new client asset before
  // creating test13/test24 disposable identities.
  const deadline = Date.now() + 14 * 60 * 1000
  let last = 'not yet observed'
  while (Date.now() < deadline) {
    try {
      const health = await api('/api/health')
      if (health.status !== 200 || health.json?.service !== 'qwerty-sync-gateway') {
        last = 'health not ready: HTTP ' + health.status
      } else {
        const response = await fetch(new URL('/', base), {
          headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(20000),
        })
        const html = await response.text()
        const match = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/.exec(html)
        if (response.ok && match) {
          const asset = new URL(match[1], base)
          asset.searchParams.set('release-check', String(Date.now()))
          const entry = await fetch(asset, {
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(20000),
          })
          const content = entry.ok ? await entry.text() : ''
          if (content.includes(EXPECTED_FRONTEND_MARKER) &&
              content.includes('s2-sync')) {
            console.log('Production V4 performance-release frontend bundle and API health: PASS')
            return
          }
          last = 'health OK, released performance bundle not yet active'
        } else {
          last = 'health OK, main frontend asset not found yet'
        }
      }
    } catch (e) {
      last = e?.name || 'network-error'
    }
    console.log('Waiting for Maker production release:', last)
    await sleep(10_000)
  }
  throw new Error('New production performance bundle not visible after 14min: ' + last)
}
function makeV4(userId, word) {
  const database = {
    formatName: 'dexie', formatVersion: 1,
    data: {
      databaseName: 'RecordDB', databaseVersion: 6,
      tables: TABLES.map(name => ({ name, schema: '++id' })),
      data: TABLES.map(name => ({ tableName: name, inbound: true,
        rows: name === 'wordRecords' ? [{ id: 1, word, source: 'P4B' }] :
          name === 'reviewWordStates' ? [{ id: 1, word, nextReviewAt: 12345 }] : [],
      })),
    },
  }
  const workspace = {
    database, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
  }
  const snapshot = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-11T00:00:00Z',
      source: { kind: 'account', accountId: userId } },
    workspaceData: workspace,
  }
  const logical = {
    database: { tables: database.data.tables, data: database.data.data },
    learnRuntime: workspace.learnRuntime, settings: workspace.settings,
    navigation: workspace.navigation,
  }
  const payload = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  return {
    snapshot,
    request: {
      baseRevision: 0, payloadBase64: payload.toString('base64'),
      clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: sha256(Buffer.from(stable(logical))),
      deviceId: 'p4b-node-A',
    },
    transportSha: sha256(payload),
  }
}
async function register(name) {
  const password = crypto.randomBytes(24).toString('base64url')
  const result = await api('/api/auth/register', {
    method: 'POST', body: { username: name, password, deviceId: 'p4b-temp-' + name },
  })
  if (result.status === 409) {
    throw new Error('Username ' + name + ' already exists. Refusing to reuse or delete existing account.')
  }
  assertStatus(result, 201, name + ' registration')
  assert.ok(result.json?.token && result.json?.user?.userId, 'new token and ID')
  secrets.set(name, password)
  active.set(name, { token: result.json.token, id: result.json.user.userId })
  created.add(name)
  console.log(name + ': newly created, immutable account ID resolved')
}
async function meta(name) {
  const result = await api('/api/sync/v2/meta', { user: name })
  assertStatus(result, 200, name + ' metadata')
  return result.json
}
async function upload(name, request, path = '/api/sync/v2') {
  return api(path, { user: name, method: 'PUT', body: request })
}
function checkDownloaded(name, expectedFingerprint, word) {
  return (async () => {
    const res = await api('/api/sync/v2', { user: name })
    assertStatus(res, 200, name + ' V4 download')
    assert.equal(res.json?.logicalFingerprint, expectedFingerprint)
    const compressed = Buffer.from(res.json.payloadBase64, 'base64')
    assert.equal(sha256(compressed), res.json.payloadSha256)
    const snapshot = JSON.parse(gunzipSync(compressed).toString('utf8'))
    assert.equal(snapshot.metadata.source.accountId, active.get(name).id)
    const table = snapshot.workspaceData.database.data.data
      .find(x => x.tableName === 'wordRecords')
    assert.equal(table.rows[0].word, word)
    assert.equal(snapshot.workspaceData.database.data.tables.length, 6)
    return res
  })()
}
async function runTests() {
  await pollDeployment()
  for (const name of NAMES) await register(name)
  const id13 = active.get('test13').id
  const id24 = active.get('test24').id
  assert.notEqual(id13, id24)
  assert.equal((await meta('test13')).revision, 0)
  assert.equal((await meta('test24')).revision, 0)

  // test13: explicit V3 -> V4 migration; do not silently allow normal PUT.
  const v3Payload = gzipSync(Buffer.from(JSON.stringify({ p4b: 'legacy-v3-data' })))
    .toString('base64')
  const v3 = await api('/api/sync', { user: 'test13', method: 'PUT',
    body: { baseRevision: 0, payloadBase64: v3Payload,
      clientFormatVersion: 'qwerty-backup-v3', deviceId: 'p4b-old-client' } })
  assertStatus(v3, 200, 'test13 V3 seed')
  assert.equal(v3.json.revision, 1)
  const prev = await meta('test13')
  const v4_13 = makeV4(id13, 'migration-word')
  const body13 = { ...v4_13.request, baseRevision: 1 }
  const implicit = await upload('test13', body13)
  assertStatus(implicit, 409, 'implicit V3 migration must reject')
  assert.equal(implicit.json.error, 'sync_migration_required')
  const invalid = await upload('test13', {
    ...body13, recoveryMode: 'migrate-v3', expectedRemoteFormat: 'qwerty-backup-v3',
    expectedRemoteSha256: 'f'.repeat(64), accountConfirmation: id13,
  }, '/api/sync/v2/recovery')
  assertStatus(invalid, 409, 'incorrect migration cloud fingerprint')
  assert.equal(invalid.json.error, 'recovery_precondition_failed')
  const explicit = await upload('test13', {
    ...body13, recoveryMode: 'migrate-v3', expectedRemoteFormat: 'qwerty-backup-v3',
    expectedRemoteSha256: prev.payloadSha256, accountConfirmation: id13,
  }, '/api/sync/v2/recovery')
  assertStatus(explicit, 200, 'explicit V3 to V4 migration')
  assert.equal(explicit.json.revision, 2)
  await checkDownloaded('test13', v4_13.request.logicalFingerprint, 'migration-word')
  const legacyBlocked = await api('/api/sync', { user: 'test13', method: 'PUT',
    body: { baseRevision: 2, payloadBase64: v3Payload,
      clientFormatVersion: 'qwerty-backup-v3' } })
  assertStatus(legacyBlocked, 409, 'old V1 client after migration')
  assert.equal(legacyBlocked.json.error, 'sync_upgrade_required')
  assert.equal((await meta('test13')).revision, 2)
  console.log('Production REAL Blob V3->V4 consent/old-write-protection: PASS')

  // test24: three independently identified device upload attempts at same CAS base.
  // Simultaneous network requests share an authenticated session, but differing
  // device IDs simulate a race; BrowserContext independence is a separate Gate.
  const candidates = ['A', 'B', 'C'].map(label => {
    const payload = makeV4(id24, 'race-' + label)
    payload.request.deviceId = 'p4b-node-' + label
    return payload
  })
  const race = await Promise.all(candidates.map(x => upload('test24', x.request)))
  const winners = race.map((x, i) => ({ ...x, index: i }))
    .filter(x => x.status === 200)
  assert.equal(winners.length, 1, 'CAS must have exactly one winner')
  const losers = race.filter(x => x.status === 409 && x.json?.error === 'sync_conflict')
  assert.equal(losers.length, 2, 'CAS must reject both stale writes')
  const winner = candidates[winners[0].index]
  assert.equal((await meta('test24')).revision, 1)
  await checkDownloaded('test24', winner.request.logicalFingerprint,
    'race-' + ['A', 'B', 'C'][winners[0].index])
  const stale = await upload('test24', candidates[(winners[0].index + 1) % 3].request)
  assertStatus(stale, 409, 'stale CAS replay')
  console.log('Production REAL Blob 3-device-ID concurrent CAS single winner: PASS')

  // Wrong-account signed-in payload cannot be accepted, even if allowlisted.
  const ownerForgery = await upload('test24', {
    ...v4_13.request, baseRevision: 1,
  })
  assertStatus(ownerForgery, 400, 'cross-account V4 forgery')
  assert.equal(ownerForgery.json.error, 'invalid_v4_workspace')
  assert.equal((await meta('test24')).revision, 1)
  console.log('Production REAL Blob cross-account V4 owner check: PASS')

  // Explicit V4 replace recovery requires pinned fingerprint + SHA.
  const v4_24 = makeV4(id24, 'recovered-word')
  const old = await meta('test24')
  const replace = {
    ...v4_24.request, baseRevision: 1,
    recoveryMode: 'replace-v4', expectedRemoteFormat: 'qwerty-backup-v4',
    expectedRemoteSha256: old.payloadSha256,
    expectedRemoteLogicalFingerprint: old.logicalFingerprint,
    accountConfirmation: id24,
  }
  const badReplace = await upload('test24', {
    ...replace, expectedRemoteLogicalFingerprint: '0'.repeat(64),
  }, '/api/sync/v2/recovery')
  assertStatus(badReplace, 409, 'bad V4 recovery')
  assert.equal((await meta('test24')).revision, 1)
  const recovered = await upload('test24', replace, '/api/sync/v2/recovery')
  assertStatus(recovered, 200, 'verified V4 recovery')
  assert.equal(recovered.json.revision, 2)
  await checkDownloaded('test24', v4_24.request.logicalFingerprint, 'recovered-word')
  console.log('Production REAL Blob V4 explicit recovery/fingerprint: PASS')

  // Single-active session: new device login must invalidate previous token,
  // without disturbing the account's latest V4 revision.
  const revokedToken = active.get('test24').token
  const relogin = await api('/api/auth/login', { method: 'POST',
    body: { username: 'test24', password: secrets.get('test24'),
      deviceId: 'p4b-restarted-device' } })
  assertStatus(relogin, 200, 'test24 second device login')
  active.set('test24', { id: id24, token: relogin.json.token })
  const revoked = await api('/api/auth/me', { token: revokedToken })
  assertStatus(revoked, 401, 'previous device token revocation')
  assert.equal((await meta('test24')).revision, 2)
  await checkDownloaded('test24', v4_24.request.logicalFingerprint, 'recovered-word')
  console.log('Production REAL Blob new-device login/restart retrieval: PASS')
  console.log('Production REAL Maker/Blob named-account protocol suite: PASS')
}
try {
  await runTests()
} catch (e) {
  firstError = e
  console.error('Production named-account suite FAIL:', e.message)
} finally {
  for (const name of [...created].reverse()) {
    try {
      const response = await api('/api/auth/account', {
        user: name, method: 'DELETE',
        body: { currentPassword: secrets.get(name) },
      })
      assertStatus(response, 200, name + ' cleanup')
      assert.equal(response.json?.deleted?.accountDeleted, true)
      console.log('Production cleanup ' + name + ': PASS')
    } catch (e) {
      firstError ||= e
      console.error('Production cleanup ' + name + ': FAILED - ' + e.message)
    }
  }
}
if (firstError) throw firstError
