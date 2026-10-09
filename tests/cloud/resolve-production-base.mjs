/* eslint-env node */
// Verify which already-published EdgeOne URL is alive; never builds or deploys.
// Canonical Alpha production domain confirmed by the project owner on 2026-10-09.
// Do not fall back to stale secrets or former project domains.
import { appendFileSync } from 'node:fs'

const candidates = ['https://qwerty-plus.edgeone.dev/']
const seen = new Set()
let verified = null

for (const candidate of candidates) {
  try {
    const base = new URL(candidate)
    if (base.protocol !== 'https:' || seen.has(base.origin)) continue
    seen.add(base.origin)
    const response = await fetch(new URL('/api/health', base.origin), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) {
      console.log('Published EdgeOne candidate rejected:', base.hostname, 'HTTP', response.status)
      continue
    }
    const health = await response.json()
    if (health.service !== 'qwerty-sync-gateway' ||
        !Array.isArray(health.capabilities) ||
        !health.capabilities.includes('learning-state-backup-v3')) {
      console.log('Published EdgeOne candidate lacks required backend:', base.hostname)
      continue
    }
    verified = base.origin
    console.log('Verified live production endpoint:', base.hostname)
    break
  } catch (error) {
    console.log('Published EdgeOne candidate unavailable:', String(error?.name || 'request_error'))
  }
}

if (!verified) {
  console.error('No verified EdgeOne production URL; aborting BEFORE account creation.')
  process.exitCode = 1
} else {
  appendFileSync(process.env.GITHUB_ENV, `QWERTY_SYNC_BASE_URL=${verified}\nQWERTY_LIVE_TEST_READY=1\n`)
}
