/* eslint-env node */
import assert from 'node:assert/strict'

// Disposable test harness only. A matching typed response proves the handler
// stopped before service.putSyncV4Binary. It never authorizes an unknown write.
export async function retryDirectPrewriteTest(send, readMetadata, expected,
  pause = attempt => new Promise(resolve => setTimeout(resolve, 850 * attempt))) {
  assert.ok(Number.isSafeInteger(expected.revision) && expected.revision >= 0,
    'Pinned revision required')
  assert.match(expected.payloadSha256 || '', /^[a-f0-9]{64}$/)
  assert.match(expected.logicalFingerprint || '', /^[a-f0-9]{64}$/)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await send()
    if (response.status !== 503 ||
        response.value?.error !== 'v4_direct_body_read_failed' ||
        attempt === 3) return response
    const observed = await readMetadata()
    assert.equal(observed.status, 200, 'Read-only revision proof unavailable; no replay')
    for (const field of ['revision', 'payloadSha256', 'logicalFingerprint']) {
      assert.equal(observed.value?.[field] === expected[field], true,
        'Pinned remote state changed or incomplete; no replay')
    }
    await pause(attempt)
  }
  throw Error('unreachable direct prewrite test state')
}
