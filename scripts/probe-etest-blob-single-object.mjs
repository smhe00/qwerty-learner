/* eslint-env node */
// etest-only, direct EdgeOne Blob SDK size-limit probe. No Maker deployment,
// HTTP body transfer, account namespace or V4 revision is touched.
// A random key is tracked BEFORE each write because failed ACKs may be ambiguous.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { getStore } from '@edgeone/pages-blob'

const ack = 'RUN_ETEST_BLOB_SINGLE_OBJECT_LIMIT_ONLY'
const projectId = process.env.ETEST_BLOB_PROJECT_ID || ''
const token = process.env.EDGEONE_API_TOKEN || ''
if (process.env.ETEST_BLOB_PROBE_ACK !== ack ||
    process.env.ETEST_BLOB_STORE !== 'qwerty-blob-limit-sandbox' ||
    !/^makers-[a-z0-9-]+$/.test(projectId) ||
    projectId === 'makers-yggquqwubqul' || // production Maker project
    !token) {
  throw new Error('Explicit etest-only project, sandbox Store and approval required')
}

const store = getStore({
  name: 'qwerty-blob-limit-sandbox', projectId, token, consistency: 'strong',
})
const root = 'single-object-size-limit/v1/' +
  crypto.randomBytes(16).toString('hex') + '/'
const bytesToCheck = [
  6_000_000,         // official Cloud Functions HTTP limit for comparison only
  6 * 1024 * 1024,   // HTTP 6 MB != SDK Blob object 6 MiB
  8 * 1024 * 1024,
  16 * 1024 * 1024,
  24_000_000,
  25_000_000,        // official Blob max: 25 MB decimal
  25 * 1024 * 1024,  // 25 MiB boundary (NOT the same as 25 MB)
  25 * 1024 * 1024 + 1,
]
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const rounded = start => Math.round(performance.now() - start)
const report = {
  probe: 'etest-blob-single-object-sdk-limit-v1',
  isolation: 'etest-project-dedicated-sandbox-namespace',
  transferLayer: 'EdgeOne Blob SDK store.set(ArrayBuffer), not HTTP upload',
  expectedDocumentedBlobLimitBytes: 25_000_000,
  cloudFunctionsHttpBodyDocumentedBytes: 6_000_000,
  objectCount: bytesToCheck.length,
  deploymentTriggered: false,
  cases: [],
}
let overallFailure = false
for (const [index, requestedBytes] of bytesToCheck.entries()) {
  const key = root + String(index).padStart(2, '0') + '.bin'
  const payload = crypto.randomBytes(requestedBytes)
  const expectedSha256 = sha(payload)
  const body = payload.buffer.slice(
    payload.byteOffset, payload.byteOffset + payload.byteLength)
  let acked = false
  let writeMs = null
  let readMs = null
  let readback = 'not_attempted'
  let failurePhase = null
  let deleteConfirmed = false
  let observedBytes = null
  let observedSha256Equal = false
  try {
    const started = performance.now()
    try {
      await store.set(key, body)
      acked = true
    } catch {
      // Do not retry an ambiguous write; inspect this exact random key.
      failurePhase = 'write_not_acknowledged'
    } finally {
      writeMs = rounded(started)
    }
    const readStarted = performance.now()
    try {
      const result = await store.get(key, {
        type: 'arrayBuffer', consistency: 'strong',
      })
      if (result === null) {
        readback = 'absent'
      } else {
        const actual = Buffer.from(result)
        observedBytes = actual.length
        observedSha256Equal = sha(actual) === expectedSha256
        readback = actual.length === requestedBytes && observedSha256Equal
          ? 'byte_exact' : 'corrupt_or_truncated'
      }
    } catch {
      readback = 'read_error'
      failurePhase ||= 'readback_failed'
    } finally {
      readMs = rounded(readStarted)
    }
    // A confirmed successful set MUST be byte-exact on strong read.
    if (acked && readback !== 'byte_exact') overallFailure = true
    // A failed set with a visible object is an ambiguous commit, not a
    // successful ACK, and must never be automatically retried.
    if (!acked && readback === 'byte_exact') failurePhase = 'ambiguous_ack'
    if (requestedBytes <= 25_000_000 &&
        (!acked || readback !== 'byte_exact')) overallFailure = true
  } finally {
    // Cleanup also runs after transport/SDK errors; no list-based inference.
    // Delete a key even if its write ACK was lost.
    try {
      await store.delete(key)
      const after = await store.get(key, {
        type: 'arrayBuffer', consistency: 'strong',
      })
      deleteConfirmed = after === null
    } catch {
      deleteConfirmed = false
    }
    if (!deleteConfirmed) overallFailure = true
    report.cases.push({
      requestedBytes, acknowledged: acked, writeMs, readMs,
      readback, observedBytes, observedSha256Equal,
      failurePhase, cleanupConfirmed: deleteConfirmed,
    })
    // No keys, token, project ID or random data in the report.
    console.log(JSON.stringify(report.cases.at(-1)))
  }
}
report.cleanupConfirmed = report.cases.every(item => item.cleanupConfirmed)
report.largestAcknowledgedByteExact = Math.max(0,
  ...report.cases.filter(item => item.acknowledged &&
    item.readback === 'byte_exact').map(item => item.requestedBytes))
report.firstUnacknowledgedBytes = report.cases.find(
  item => !item.acknowledged)?.requestedBytes ?? null
report.verdict = overallFailure ? 'FAIL' : 'PASS'
console.log(JSON.stringify(report))
assert.equal(overallFailure, false,
  'Isolated etest Blob boundary probe failed; inspect sanitised case report')
