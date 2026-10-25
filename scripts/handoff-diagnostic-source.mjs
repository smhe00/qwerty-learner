/* eslint-env node */
// Diagnostic-only source gate. The release/staging gate remains unchanged.
// A feature-branch runner may examine the explicitly pinned current etest;
// it cannot certify a feature SHA as deployed or change any remote ref.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
assert.equal(process.env.GITHUB_REF_NAME, 'fix/session-handoff-20261025')
const sha = process.env.EXPECTED_SHA
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.equal(process.env.QWERTY_SYNC_BASE_URL, 'https://t.smhe.cn/')
const remote = execFileSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/edgeone-test'], { encoding: 'utf8' }).trim()
assert.equal(remote, `${sha}\trefs/heads/edgeone-test`, 'Staging ref changed; stop rather than test another version')
const url = new URL('source-commit.txt', process.env.QWERTY_SYNC_BASE_URL)
url.searchParams.set('handoff_diagnosis', sha + '-' + Date.now())
const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
assert.equal(response.status, 200)
const marker = (await response.text()).trim()
assert.match(marker, /^[a-f0-9]{7,40}$/)
assert.ok(sha.startsWith(marker), 'Published staging source does not match pinned candidate')
console.log('PASS diagnostic source matches current etest', marker)
