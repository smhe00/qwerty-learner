/* eslint-env node */
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'

const base = 'https://etest.edgeone.dev/'
const configured = new URL(process.env.QWERTY_SYNC_BASE_URL || base)
assert.equal(configured.origin, new URL(base).origin,
  'Cloud development E2E MUST target the etest EdgeOne origin')
const response = await fetch(new URL('/api/health', base), {
  headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
})
assert.equal(response.status, 200, 'etest EdgeOne /api/health')
const health = await response.json()
assert.equal(health.service, 'qwerty-sync-gateway')
assert.ok(health.capabilities?.includes('edgeone-same-origin-e2e-v1'),
  'etest EdgeOne backend is not yet deployed with same-origin E2E capability')
console.log('Validated etest EdgeOne gateway: ' + configured.hostname)
if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV,
    'QWERTY_SYNC_BASE_URL=' + base + '\nQWERTY_LIVE_TEST_READY=1\n')
}
