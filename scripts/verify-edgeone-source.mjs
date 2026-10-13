/* eslint-env node */
import assert from 'node:assert/strict'

const sha = process.env.EXPECTED_SHA
assert.match(sha || '', /^[a-f0-9]{40}$/, 'Expected source SHA required')
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test', 'Only etest may pass this check')
const base = 'https://etest.edgeone.dev/'
const result = await fetch(new URL('source-commit.txt', base), {
  cache: 'no-store', signal: AbortSignal.timeout(15000),
})
assert.equal(result.status, 200, 'Missing staging build source marker')
const marker = (await result.text()).trim()
assert.match(marker, /^[a-f0-9]{7,40}$/,
  'Missing/unknown source SHA: stale deployment cannot pass E2E')
assert.ok(sha.startsWith(marker), 'Staging frontend is not this etest commit')
console.log('PASS: etest published frontend matches source', marker)
