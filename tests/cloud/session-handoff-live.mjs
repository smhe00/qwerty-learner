/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { fixture } from './session-handoff-fixtures.mjs'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

// Explicit staging only. No user credentials, existing account or production
// endpoint is accepted. Never blindly retry a possibly committed POST.
const base = process.env.QWERTY_SYNC_BASE_URL || 'https://t.smhe.cn/'
assert.equal(new URL(base).origin, 'https://t.smhe.cn')
assert.equal(new URL(base).pathname, '/')
const username = 'qh26' + crypto.randomBytes(12).toString('hex')
const password = crypto.randomBytes(24).toString('hex')
const report = { scope: 'new-disposable-account', capability: 'account-handoff-blob-fixtures-v1',
  productionTouched: false, sourceSha: process.env.EXPECTED_SHA || null, checks: [], cleanup: 'not-started' }
let currentToken, accountId, safeToCleanup = true
const inFlight = []
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
function check(name, condition) {
  assert.ok(condition, name)
  report.checks.push({ name, passed: true }); console.log('PASS', name)
}
async function call(path, { method = 'GET', token, body, bytes, headers = {} } = {}) {
  const result = await fetch(new URL('/api' + path, base), { method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(bytes ? { body: bytes } : body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90_000), cache: 'no-store' })
  let data
  try { data = await result.json() } catch { throw new Error(`HTTP ${result.status}: non-JSON response`) }
  return { status: result.status, data, guarded: result.headers.get('x-qwerty-handoff') }
}
function input(words, revision) {
  const result = fixture(accountId, words, revision)
  verifyCompressedV4(result.payloadBytes, accountId, result.logicalFingerprint)
  return result
}

const direct = (token, payload, hold = 0) => call('/sync/v2/binary/direct', { method: 'POST', token,
  bytes: payload.payloadBytes, headers: { 'Content-Type': 'application/octet-stream',
    'X-Qwerty-Base-Revision': String(payload.baseRevision),
    'X-Qwerty-Logical-Fingerprint': payload.logicalFingerprint,
    'X-Qwerty-Payload-Sha256': hash(payload.payloadBytes),
    ...(hold ? { 'X-Qwerty-Handoff-Hold-Ms': String(hold) } : {}) } })
async function waitStatus(token, predicate) {
  for (let i = 0; i < 25; i++) {
    const result = await call('/auth/handoff/status', { token })
    if (result.status === 200 && predicate(result.data)) return result.data
    if (result.status !== 200) throw new Error('handoff status unavailable before the required checkpoint')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Required race checkpoint was not exercised; test is inconclusive, not passing')
}
try {
  const health = await call('/health')
  check('matching deployed handoff capability', health.status === 200 &&
    health.data.capabilities?.includes(report.capability) && health.data.handoffProductionReady === false)
  const policy = await call('/account-policy')
  check('executing global cleanup is disabled for qualification', policy.status === 200 && policy.data.executionEnabled === false)
  const registered = await call('/auth/register', { method: 'POST', body: { username, password, deviceId: 'handoff-A' } })
  check('new fixture account enters the guarded gateway', registered.status === 201 && registered.guarded === report.capability)
  currentToken = registered.data.token; accountId = registered.data.user.userId
  const aToken = currentToken, alpha = input(['alpha'], 0)
  safeToCleanup = false
  const uploading = direct(aToken, alpha, 5000)
  inFlight.push(uploading); uploading.catch(() => {})
  // Observe a MANIFEST boundary, not a client timer or a sleep as proof of drain.
  await waitStatus(aToken, state => state.heldWriters === 1)
  const loggingIn = call('/auth/login', { method: 'POST', body: { username, password, deviceId: 'handoff-B' } })
  inFlight.push(loggingIn); loggingIn.catch(() => {})
  const pending = await waitStatus(aToken, state => state.pendingHandoffs > 0 && state.activeWriters > 0)
  check('B is pending while A still owns the manifest publication', pending.pendingHandoffs === 1)
  const refused = await direct(aToken, alpha)
  check('new old-session write is rejected rather than published', [401, 409].includes(refused.status))
  const [uploaded, loggedIn] = await Promise.all([uploading, loggingIn])
  check('A publication completed before B obtained the guarded login result',
    uploaded.status === 200 && loggedIn.status === 200 && loggedIn.guarded === report.capability)
  currentToken = loggedIn.data.token
  let meta = await call('/sync/v2/meta', { token: currentToken })
  check('B immediately sees A revision and exact payload', meta.status === 200 && meta.data.revision === 1 &&
    meta.data.dataSha256 === hash(alpha.payloadBytes))
  const late = await direct(aToken, input(['late-old-A'], 1))
  check('late A cannot publish after B login', late.status === 401)
  const combined = input(['alpha', 'beta'], 1)
  const bWrite = await direct(currentToken, combined)
  check('B publishes the union as revision 2', bWrite.status === 200 && bWrite.data.revision === 2)
  const bToken = currentToken
  const logout = await call('/auth/logout', { method: 'POST', token: bToken })
  check('single-session explicit logout is durable', logout.status === 200 && logout.data.revoked === true)
  check('logged-out token is refused', (await call('/auth/me', { token: bToken })).status === 401)
  currentToken = null
  const cLogin = await call('/auth/login', { method: 'POST', body: { username, password, deviceId: 'handoff-C' } })
  check('next device can take over after confirmed logout', cLogin.status === 200)
  currentToken = cLogin.data.token
  meta = await call('/sync/v2/meta', { token: currentToken })
  check('next device preserves both learning records', meta.status === 200 && meta.data.revision === 2 &&
    meta.data.dataSha256 === hash(combined.payloadBytes))
  safeToCleanup = true
  report.passed = true
} catch (error) {
  report.passed = false
  // Never serialize HTTP bodies, tokens, passwords or provider paths.
  report.failure = error instanceof assert.AssertionError ? error.message : error.name
  console.error('Handoff qualification failed:', report.failure)
  process.exitCode = 1
} finally {
  await Promise.allSettled(inFlight)
  if (currentToken && safeToCleanup) {
    try {
      const result = await call('/auth/account', { method: 'DELETE', token: currentToken, body: { currentPassword: password } })
      report.cleanup = result.status === 200 ? 'synthetic-account-deleted' : 'refused'
      if (result.status !== 200) process.exitCode = 1
    } catch { report.cleanup = 'unknown'; process.exitCode = 1 }
  } else if (currentToken) report.cleanup = 'retained-uncertain-fixture-no-force-unlock'
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/handoff-live-redacted.json', JSON.stringify(report, null, 2))
}
