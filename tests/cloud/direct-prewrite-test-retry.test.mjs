/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { retryDirectPrewriteTest } from './direct-prewrite-test-retry.mjs'

const expected = { revision: 3, payloadSha256: 'a'.repeat(64), logicalFingerprint: 'b'.repeat(64) }
const prewrite = { status: 503, value: { error: 'v4_direct_body_read_failed' } }
function fixture(responses, metadata = { status: 200, value: expected }) {
  let sends = 0, reads = 0, pauses = 0
  return {
    run: () => retryDirectPrewriteTest(async () => {
      const result = responses[Math.min(sends++, responses.length - 1)]
      if (result instanceof Error) throw result
      return result
    }, async () => { reads++; if (metadata instanceof Error) throw metadata; return metadata },
    expected, async () => { pauses++ }),
    counts: () => ({ sends, reads, pauses }),
  }
}
test('typed prewrite failure retries only after exact revision and both hashes are verified', async () => {
  const rejected = { status: 400, value: { error: 'v4_direct_payload_sha_mismatch' } }
  const f = fixture([prewrite, rejected])
  assert.equal(await f.run(), rejected)
  assert.deepEqual(f.counts(), { sends: 2, reads: 1, pauses: 1 })
})
test('a successful rejection is not replayed', async () => {
  const f = fixture([{ status: 400 }])
  assert.equal((await f.run()).status, 400)
  assert.deepEqual(f.counts(), { sends: 1, reads: 0, pauses: 0 })
})
test('changed revision, payload hash or logical hash prevents replay', async () => {
  for (const field of Object.keys(expected)) {
    const f = fixture([prewrite], { status: 200, value: { ...expected, [field]: field === 'revision' ? 4 : 'c'.repeat(64) } })
    await assert.rejects(f.run(), /Pinned remote state/)
    assert.equal(f.counts().sends, 1)
  }
})
test('unavailable or incomplete read-only proof prevents replay', async () => {
  for (const metadata of [{ status: 503 }, { status: 200, value: { revision: 3 } }, new Error('read timeout')]) {
    const f = fixture([prewrite], metadata)
    await assert.rejects(f.run())
    assert.equal(f.counts().sends, 1)
  }
})
test('unknown 5xx, missing error and unrelated 503 never authorize replay', async () => {
  for (const response of [{ status: 500 }, { status: 503 }, { status: 503, value: { error: 'request_body_unavailable' } }]) {
    const f = fixture([response])
    assert.equal(await f.run(), response)
    assert.deepEqual(f.counts(), { sends: 1, reads: 0, pauses: 0 })
  }
})
test('network timeout is propagated without replay', async () => {
  const f = fixture([new Error('unknown POST outcome')])
  await assert.rejects(f.run(), /unknown POST outcome/)
  assert.deepEqual(f.counts(), { sends: 1, reads: 0, pauses: 0 })
})
test('three prewrite failures remain a failure response, never a synthetic pass', async () => {
  const f = fixture([prewrite])
  assert.equal(await f.run(), prewrite)
  assert.deepEqual(f.counts(), { sends: 3, reads: 2, pauses: 2 })
})
