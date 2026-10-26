import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryMigrationPrewriteTest } from './migration-prewrite-test-retry.mjs'
const expected = { revision: 2, payloadSha256: 'a'.repeat(64), logicalFingerprint: 'b'.repeat(64), storageEncoding: 'base64' }
const prewrite = { status: 503, value: { error: 'request_body_unavailable', details: { stage: 'request-body', safeToRetry: true } } }
function fixture(first = prewrite, meta = { status: 200, value: expected }, second = { status: 200 }) {
  let sends = 0, reads = 0
  return { counts: () => ({ sends, reads }), run: () => retryMigrationPrewriteTest(async () => {
    sends++; if (first instanceof Error) throw first; return sends === 1 ? first : second
  }, async () => { reads++; return meta }, expected, async () => {}) }
}
test('migration repeats once only with pre-business certificate and full pinned metadata', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 200); assert.deepEqual(f.counts(), { sends: 2, reads: 1 })
})
test('a second certified migration rejection remains a failure', async () => {
  const f = fixture(prewrite, { status: 200, value: expected }, prewrite)
  assert.equal(await f.run(), prewrite); assert.equal(f.counts().sends, 2)
})
test('migration timeout, unknown 5xx, or incomplete certificate never authorizes replay', async () => {
  for (const first of [{ status: 500 }, { status: 503 }, { status: 503, value: { error: 'request_body_unavailable' } },
    { ...prewrite, value: { ...prewrite.value, details: { stage: 'commit', safeToRetry: true } } },
    { ...prewrite, value: { ...prewrite.value, details: { stage: 'request-body', safeToRetry: false } } }]) {
    const f = fixture(first); assert.equal(await f.run(), first); assert.deepEqual(f.counts(), { sends: 1, reads: 0 })
  }
  const f = fixture(new Error('unknown outcome')); await assert.rejects(f.run(), /unknown outcome/); assert.equal(f.counts().sends, 1)
})
test('any changed migration metadata or unavailable proof prohibits replay', async () => {
  const metas = [{ status: 503 }, { status: 200, value: {} }, ...Object.keys(expected).map(field =>
    ({ status: 200, value: { ...expected, [field]: field === 'revision' ? 3 : 'different' } }))]
  for (const meta of metas) { const f = fixture(prewrite, meta); await assert.rejects(f.run()); assert.equal(f.counts().sends, 1) }
})
