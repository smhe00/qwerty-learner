/* eslint-env node */
import assert from 'node:assert/strict'

/**
 * etest backend prerequisite for the SINGLE-ACTIVE-SESSION relay.
 * A new frontend SHA never establishes an EdgeOne Function's auth mode.
 * Immutable event pilot availability is independently tested by the real
 * M3 receipt relay script; neither test is full-V4 reconciliation.
 */
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
const url = new URL(process.env.QWERTY_SYNC_BASE_URL || '')
assert.equal(url.origin, 'https://etest.edgeone.dev')
const deadline = Date.now() + 180_000
let reason = 'not checked'
for (;;) {
  try {
    const resp = await fetch(new URL('/api/health', url), {
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    const h = await resp.json()
    const current = h.capabilities?.includes('etest-single-session-relay-v1')
    if (resp.ok && current && h.authMode === 'single-active-session') {
      console.log('PASS: etest backend single active session (M1 not needed)')
      break
    }
    reason = 'HTTP ' + resp.status +
      ' backendMarker=' + String(Boolean(current)) +
      ' authMode=' + String(h.authMode) +
      ' originMatched=' + String(h.pilotOriginMatched)
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err)
  }
  if (Date.now() >= deadline) {
    throw Error('etest single-session backend not ready; no test accounts created: ' + reason)
  }
  console.log('Waiting for etest FUNCTION single-session policy:', reason)
  await new Promise(resolve => setTimeout(resolve, 6000))
}
