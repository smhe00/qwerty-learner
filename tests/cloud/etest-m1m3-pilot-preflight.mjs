/* eslint-env node */
/**
 * Real etest M1+M3 prerequisite before any disposable browser account.
 * Exact static source SHA alone does not prove EdgeOne Function runtime.
 */
import assert from 'node:assert/strict'

assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
const origin = new URL(process.env.QWERTY_SYNC_BASE_URL || '')
assert.equal(origin.origin, 'https://etest.edgeone.dev')
const deadline = Date.now() + 180_000
let reason = 'backend not queried'
for (;;) {
  try {
    const response = await fetch(new URL('/api/health', origin), {
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    const health = await response.json()
    const runtimeCurrent = health.capabilities?.includes('etest-m1m3-origin-gate-v1')
    const matched = health.pilotOriginMatched === true
    const multi = health.authMode === 'independent-device-sessions-pilot'
    if (response.ok && runtimeCurrent && matched && multi) {
      console.log('PASS: exact etest backend Function M1+M3 pilot verified')
      break
    }
    reason = 'HTTP ' + response.status + ' newBackend=' +
      String(Boolean(runtimeCurrent)) + ' host=' +
      String(health.pilotRequestHost || 'unreported') +
      ' originMatched=' + String(health.pilotOriginMatched) +
      ' authMode=' + String(health.authMode)
  } catch (error) {
    reason = error instanceof Error ? error.message : 'network unavailable'
  }
  if (Date.now() >= deadline) {
    throw Error('etest backend pilot unavailable; no learning accounts created: ' + reason)
  }
  console.log('Waiting for exact branch-matched etest FUNCTION runtime:', reason)
  await new Promise(done => setTimeout(done, 6000))
}
