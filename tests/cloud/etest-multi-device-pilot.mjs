/* eslint-env node */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

// Opt-in only. Production and Pages MUST never be touched by this test.
const base = process.env.QWERTY_SYNC_BASE_URL
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
assert.equal(new URL(base).origin, 'https://etest.edgeone.dev')
const runId = process.env.GITHUB_RUN_ID
assert.match(runId || '', /^\d+$/)
const username = 'e2e_m3_' + runId + '_' + (process.env.GITHUB_RUN_ATTEMPT || '1')
const password = 'E2E-' + randomBytes(16).toString('hex')
const deviceA = 'qwerty-web-' + randomUUID()
const deviceB = 'qwerty-web-' + randomUUID()
async function call(method, path, token, input, status = 200) {
  const url = new URL(path, base)
  assert.equal(url.origin, 'https://etest.edgeone.dev')
  const response = await fetch(url, {
    method, cache: 'no-store',
    headers: { Accept: 'application/json',
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(20000),
  })
  const body = await response.json().catch(() => ({}))
  assert.equal(response.status, status, method + ' ' + url.pathname + ' error ' + body.error)
  return body
}
const health = await call('GET', '/api/health')
assert.equal(health.authMode, 'independent-device-sessions-pilot',
  'Enable independent-auth only on the isolated etest environment')
let tokenA = ''
let tokenB = ''
let cleanupFailed = false
try {
  const a = await call('POST', '/api/auth/register', '', {
    username, password, deviceId: deviceA,
  }, 201)
  tokenA = a.token
  assert.ok(tokenA)
  const b = await call('POST', '/api/auth/login', '', {
    username, password, deviceId: deviceB,
  })
  tokenB = b.token
  assert.ok(tokenB && tokenA !== tokenB)
  await Promise.all([
    call('GET', '/api/auth/me', tokenA),
    call('GET', '/api/auth/me', tokenB),
  ])
  const sharedId = randomUUID()
  const evidence = (word, attemptId = randomUUID()) => ({
    attemptId, dict: 'm3-test', word,
    timeStamp: Math.floor(Date.now() / 1000), chapter: -1,
    wrongCount: 0, mistakes: {}, timing: [],
    sourceMode: 'learn', learnItemKind: 'review',
  })
  const same = evidence('shared', sharedId)
  const payload = (deviceId, events) => ({
    deviceId, batchId: randomUUID(), sequence: 1, previous: null, events,
  })
  const [left, right] = await Promise.all([
    call('POST', '/api/sync/events/v2', tokenA,
      payload(deviceA, [same, evidence('left')]), 201),
    call('POST', '/api/sync/events/v2', tokenB,
      payload(deviceB, [same, evidence('right')]), 201),
  ])
  const receipt = r => ({ deviceId: r.deviceId, sequence: r.sequence,
    batchId: r.batchId, sha256: r.sha256 })
  const heads = [receipt(left), receipt(right)]
  for (const [r, token] of [[heads[0], tokenB], [heads[1], tokenA]]) {
    const qs = new URLSearchParams({ deviceId: r.deviceId,
      sequence: String(r.sequence), batchId: r.batchId, sha256: r.sha256 })
    const got = await call('GET', '/api/sync/events/v2?' + qs, token)
    assert.equal(got.batch.sha256, r.sha256)
  }
  const verified = await call('POST', '/api/sync/events/v2/verify-set',
    tokenA, { heads })
  assert.equal(verified.verified, true)
  assert.equal(verified.uniqueAttemptCount, 3)
  assert.equal(verified.duplicateAttemptCount, 1)
  assert.equal(verified.deviceCount, 2)
  assert.equal(verified.convergenceComplete, false)
  assert.equal(verified.publishReady, false)
  const reverse = await call('POST', '/api/sync/events/v2/verify-set',
    tokenB, { heads: heads.slice().reverse() })
  assert.equal(reverse.evidenceSha256, verified.evidenceSha256)
  console.log('PASS: two authenticated devices, three unique immutable Blob attempts; no completeness claim')
} finally {
  if (tokenA) {
    try {
      const result = await call('DELETE', '/api/auth/account', tokenA, {
        currentPassword: password,
      })
      assert.equal(result.deleted.accountDeleted, true)
    } catch {
      cleanupFailed = true
      console.error('etest disposable account cleanup FAILED')
    }
  }
}
assert.equal(cleanupFailed, false)
