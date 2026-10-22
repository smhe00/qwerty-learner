/* eslint-env node */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

/**
 * REAL etest single-active-session relay.
 * A uploads while its token is valid; B login revokes A, but B may read
 * immutable evidence from A. B uploads its own; A reauth revokes B and
 * discovers both. No independent-sessions M1 capability is needed.
 * This is an immutable M3 transport proof, NOT full-V4 auto adoption.
 */
const base = process.env.QWERTY_SYNC_BASE_URL
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
assert.equal(new URL(base).origin, 'https://etest.edgeone.dev')
assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
const username = 'e2e_m3_' + process.env.GITHUB_RUN_ID + '_' +
  (process.env.GITHUB_RUN_ATTEMPT || '1')
const password = 'E2E-' + randomBytes(16).toString('hex')
const deviceA = 'qwerty-web-' + randomUUID()
const deviceB = 'qwerty-web-' + randomUUID()
async function call(method, path, token, input, status = 200) {
  const url = new URL(path, base)
  assert.equal(url.origin, 'https://etest.edgeone.dev')
  const response = await fetch(url, {
    method, cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json',
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(20000),
  })
  const body = await response.json().catch(() => ({}))
  assert.equal(response.status, status,
    method + ' ' + url.pathname + ': HTTP ' + response.status +
    ' error=' + body.error)
  return body
}
const health = await call('GET', '/api/health')
assert.equal(health.authMode, 'single-active-session',
  'Single-session relay must not depend on M1 independent login')
let token = '', registered = false
try {
  const account = await call('POST', '/api/auth/register', '', {
    username, password, deviceId: deviceA,
  }, 201)
  token = account.token
  registered = true
  assert.ok(token && account.user?.userId)
  const id = account.user.userId
  const shared = randomUUID()
  const evidence = (word, attemptId = randomUUID()) => ({
    attemptId, dict: 'm3-relay-test', word,
    timeStamp: 1800100000, chapter: -1,
    wrongCount: 0, mistakes: {}, timing: [],
    sourceMode: 'learn', learnItemKind: 'review',
  })
  const payload = (deviceId, events) => ({
    deviceId, batchId: randomUUID(), sequence: 1, previous: null, events,
  })
  const first = await call('POST', '/api/sync/events/v2', token,
    payload(deviceA, [evidence('shared', shared), evidence('left')]), 201)
  const receipt = item => ({ deviceId: item.deviceId,
    sequence: item.sequence, batchId: item.batchId, sha256: item.sha256 })
  const headA = receipt(first)
  const loginB = await call('POST', '/api/auth/login', '', {
    username, password, deviceId: deviceB,
  })
  assert.equal(loginB.user.userId, id)
  const oldA = token
  token = loginB.token
  assert.ok(token && token !== oldA)
  const revokedA = await call('GET', '/api/auth/me', oldA, undefined, 401)
  assert.equal(revokedA.error, 'session_revoked',
    'A must retain offline records after rejected stale session')
  const qsA = new URLSearchParams({ deviceId: headA.deviceId,
    sequence: String(headA.sequence),
    batchId: headA.batchId, sha256: headA.sha256 })
  const aOnB = await call('GET', '/api/sync/events/v2?' + qsA, token)
  assert.equal(aOnB.batch.sha256, headA.sha256)
  const second = await call('POST', '/api/sync/events/v2', token,
    payload(deviceB, [evidence('shared', shared), evidence('right')]), 201)
  const headB = receipt(second)
  const both = await call('POST', '/api/sync/events/v2/verify-set',
    token, { heads: [headA, headB] })
  assert.equal(both.verified, true)
  assert.equal(both.uniqueAttemptCount, 3)
  assert.equal(both.duplicateAttemptCount, 1)
  assert.equal(both.deviceCount, 2)
  assert.equal(both.convergenceComplete, false)
  assert.equal(both.publishReady, false)
  const tokenB = token
  const loginAAgain = await call('POST', '/api/auth/login', '', {
    username, password, deviceId: deviceA,
  })
  assert.equal(loginAAgain.user.userId, id)
  token = loginAAgain.token
  const revokedB = await call('GET', '/api/auth/me', tokenB, undefined, 401)
  assert.equal(revokedB.error, 'session_revoked')
  const reversed = await call('POST', '/api/sync/events/v2/verify-set',
    token, { heads: [headB, headA] })
  assert.equal(reversed.evidenceSha256, both.evidenceSha256)
  assert.equal(reversed.publishReady, false)
  console.log('PASS etest single session: A->B->A relay, revoked tokens 401, unique immutable event union; full V4 auto adoption NOT asserted')
} finally {
  if (registered) {
    // Cleanup ONLY the verified disposable username, with a newly authenticated
    // token if a prior step revoked the current bearer.
    const fresh = await call('POST', '/api/auth/login', '', {
      username, password, deviceId: deviceA,
    })
    assert.equal(fresh.user.username, username)
    const deleted = await call('DELETE', '/api/auth/account', fresh.token, {
      currentPassword: password,
    })
    assert.equal(deleted.deleted?.accountDeleted, true)
  }
}
