/* eslint-env node */
import assert from 'node:assert/strict'

const sha = process.env.EXPECTED_SHA
assert.match(sha || '', /^[a-f0-9]{40}$/, 'Expected source SHA required')
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test', 'Only etest may pass this check')

const base = 'https://etest.edgeone.dev/'
const waitMs = Math.max(0, Math.min(900_000, Number(process.env.EDGEONE_WAIT_MS || '0') || 0))
const deadline = Date.now() + waitMs
let last = 'unavailable'

for (;;) {
  try {
    const url = new URL('source-commit.txt', base)
    // Bypass EdgeOne CDN POP caching while waiting for a deployment.
    url.searchParams.set('etest_probe', sha + '-' + Date.now())
    const result = await fetch(url, {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    })
    assert.equal(result.status, 200, 'Missing staging build source marker')
    const marker = (await result.text()).trim()
    assert.match(marker, /^[a-f0-9]{7,40}$/,
      'Missing/unknown source SHA: stale deployment cannot pass E2E')
    assert.ok(sha.startsWith(marker), 'Staging frontend is not this etest commit')
    console.log('PASS: etest published frontend matches source', marker)
    break
  } catch (error) {
    last = error instanceof Error ? error.message : String(error)
    if (Date.now() >= deadline) {
      throw new Error('etest source SHA not propagated before deadline: ' + last)
    }
    console.log('Waiting for matching etest frontend SHA:', last)
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
}
