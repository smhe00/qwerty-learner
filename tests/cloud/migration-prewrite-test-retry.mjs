/* eslint-env node */
import assert from 'node:assert/strict'
// Disposable migration fixture only. The gateway's readJson certificate is
// emitted before migrateSyncV4Binary is called. It permits ONE fresh attempt.
export async function retryMigrationPrewriteTest(send, readMetadata, expected,
  pause = () => new Promise(resolve => setTimeout(resolve, 500))) {
  assert.ok(Number.isSafeInteger(expected.revision) && expected.revision >= 0)
  assert.match(expected.payloadSha256 || '', /^[a-f0-9]{64}$/)
  assert.match(expected.logicalFingerprint || '', /^[a-f0-9]{64}$/)
  assert.ok(['base64', 'binary'].includes(expected.storageEncoding))
  const first = await send()
  if (first.status !== 503 || first.value?.error !== 'request_body_unavailable' ||
      first.value?.details?.stage !== 'request-body' || first.value?.details?.safeToRetry !== true) return first
  const observed = await readMetadata()
  assert.equal(observed.status, 200, 'Migration prewrite metadata unavailable; no replay')
  for (const field of ['revision', 'payloadSha256', 'logicalFingerprint', 'storageEncoding'])
    assert.equal(observed.value?.[field], expected[field], 'Migration pinned state changed; no replay')
  console.warn('MIGRATION_PREWRITE_RETRY', JSON.stringify({ status: first.status,
    code: first.value.error, unchangedRevision: expected.revision, retry: 1 }))
  await pause()
  return send()
}
