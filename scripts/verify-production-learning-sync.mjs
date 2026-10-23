/* eslint-env node */
import assert from 'node:assert/strict'

assert.equal(process.env.GITHUB_REF_NAME, 'master')
assert.equal(process.env.QWERTY_PRODUCTION_SYNC_ACCEPTANCE, 'true')
assert.equal(new URL(process.env.QWERTY_SYNC_BASE_URL || '').href, 'https://q.smhe.cn/')
const expected = process.env.GITHUB_SHA
assert.match(expected || '', /^[a-f0-9]{40}$/)
const deadline = Date.now() + 12 * 60_000
let last = 'not checked'
while (Date.now() < deadline) {
  try {
    const marker = await fetch('https://q.smhe.cn/source-commit.txt?sync_probe=' +
      expected + '-' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    assert.equal(marker.status, 200)
    const deployed = (await marker.text()).trim()
    assert.match(deployed, /^[a-f0-9]{7,40}$/)
    assert.ok(expected.startsWith(deployed), 'production source is still stale')
    const response = await fetch('https://q.smhe.cn/api/health', {
      cache: 'no-store', signal: AbortSignal.timeout(15_000),
    })
    assert.equal(response.status, 200)
    const health = await response.json()
    assert.equal(health.service, 'qwerty-sync-gateway')
    assert.equal(health.authMode, 'single-active-session')
    assert.equal(health.eventPilotMode, 'immutable-events-only')
    assert.ok(health.capabilities?.includes('single-session-event-no-env-v1'))
    console.log('PASS: exact production SHA and single-session gateway; no accounts created yet')
    process.exit(0)
  } catch (error) {
    last = error instanceof Error ? error.message : 'verification unavailable'
    console.log('Waiting for production source and gateway:', last)
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
}
throw Error('Production preflight failed; no accounts created: ' + last)
