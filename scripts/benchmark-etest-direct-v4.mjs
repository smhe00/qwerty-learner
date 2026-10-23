/* eslint-env node */
// Read-only preflight; disposable etest account ONLY. Each ambiguous write
// halts subsequent uploads. Never touches production/master accounts.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../cloud-functions/_shared/sync-v4.js'

const origin = 'https://t.smhe.cn/'
const expectedSha = '30e0be26c05eef1eb3c85c644e85f8e22c30270c'
if (process.env.ETEST_DIRECT_BENCH_ACK !== 'ISOLATED_512K_DIRECT') {
  throw Error('Explicit etest-only benchmark acknowledgement required')
}
const sha = x => crypto.createHash('sha256').update(x).digest('hex')
const now = () => performance.now()
const round = n => Math.round(n * 100) / 100
const results = []
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function api(path, method = 'GET', body, token, binaryHeaders) {
  const headers = { Accept: 'application/json', ...binaryHeaders }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined && !binaryHeaders) headers['Content-Type'] = 'application/json'
  const outgoing = Buffer.isBuffer(body) ? body
    : body === undefined ? undefined : JSON.stringify(body)
  const t = now()
  const rsp = await fetch(new URL(path, origin), {
    method, headers, body: outgoing, redirect: 'error',
    signal: AbortSignal.timeout(30000),
  })
  const txt = await rsp.text()
  let value
  try { value = JSON.parse(txt) } catch { value = null }
  return { status: rsp.status, value, httpMs: round(now() - t),
    requestBytes: outgoing ? Buffer.byteLength(outgoing) : 0 }
}
async function ensureDeployed() {
  const health = await api('/api/health')
  assert.equal(health.status, 200, 'etest health is reachable')
  assert.ok(health.value?.capabilities?.includes('v4-binary-direct-512k-v1'),
    'etest direct V4 binary backend is NOT deployed; no account created')
  // Frontend source stamp is embedded in built JS; the branch E2E SHA gate
  // validates this independently. Backend capability validates this route.
  console.log('ETEST_DIRECT_PREFLIGHT ' + JSON.stringify({
    target: origin, expectedSourceSha: expectedSha,
    backendDirectV4: true,
  }))
}
function fixture(userId, baseRevision, targetKiB) {
  const tableNames = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = tableNames.map(name => ({ name, schema: '++id' }))
  let entropyLength = Math.floor(targetKiB * 1024 * 0.984)
  const entropy = crypto.randomBytes(entropyLength + 12000)
  let zipped, fingerprint
  for (let tries = 0; tries < 8; tries++) {
    const rows = tableNames.map(tableName => ({
      tableName, inbound: true, rows: tableName === 'wordRecords'
        ? [{ id: 1, word: 'isolated-direct-benchmark',
          typingTelemetry: { synthetic:
            entropy.subarray(0, entropyLength).toString('base64') } }] : [],
    }))
    const workspaceData = {
      database: { formatName: 'dexie', formatVersion: 1, data: {
        databaseName: 'RecordDB', databaseVersion: 6, tables, data: rows,
      } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'benchmark-test-only', currentChapter: 0 },
    }
    const snapshot = {
      backupFormatVersion: 'qwerty-backup-v4',
      metadata: {
        createdAt: '2026-10-15T00:00:00.000Z',
        source: { kind: 'account', accountId: userId },
      },
      workspaceData,
    }
    fingerprint = sha(stable({
      database: { tables, data: rows },
      learnRuntime: workspaceData.learnRuntime,
      settings: workspaceData.settings,
      navigation: workspaceData.navigation,
    }))
    zipped = gzipSync(Buffer.from(JSON.stringify(snapshot)))
    const overshoot = zipped.length - targetKiB * 1024
    if (overshoot >= -750 && overshoot <= 0) break
    entropyLength -= overshoot > 0
      ? Math.min(entropyLength - 1, overshoot + 100)
      : Math.max(-3000, overshoot + 300)
    assert.ok(entropyLength > 1000 && entropyLength <= entropy.length)
  }
  assert.ok(zipped.length <= 512 * 1024 &&
    Math.abs(zipped.length - targetKiB * 1024) < 2048,
    'compressed direct fixture target unexpectedly missed')
  assert.equal(
    verifyCompressedV4(zipped, userId, fingerprint).logicalFingerprint,
    fingerprint, 'full canonical V4 validation')
  return { bytes: zipped, fingerprint, baseRevision }
}
async function verifyCommitted(token, fix) {
  const start = now()
  const meta = await api('/api/sync/v2/meta', 'GET', undefined, token)
  assert.equal(meta.status, 200)
  assert.equal(meta.value?.revision, fix.baseRevision + 1)
  assert.equal(meta.value?.payloadSha256, sha(fix.bytes))
  assert.equal(meta.value?.logicalFingerprint, fix.fingerprint)
  assert.equal(meta.value?.storageEncoding, 'binary')
  const manifest = await api('/api/sync/v2/binary/manifest',
    'GET', undefined, token)
  assert.equal(manifest.status, 200)
  assert.equal(manifest.value?.revision, fix.baseRevision + 1)
  assert.equal(manifest.value?.count, 1)
  const params = new URLSearchParams({
    revision: String(manifest.value.revision),
    sha: sha(fix.bytes), index: '0',
  })
  const res = await fetch(new URL('/api/sync/v2/binary/part?' + params, origin), {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), fix.bytes)
  assert.equal(sha(fix.bytes), manifest.value.partSha256s[0])
  return round(now() - start)
}
await ensureDeployed()
const username = 'v4direct' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
const password = crypto.randomBytes(20).toString('base64url')
let account = null
let failure = null
try {
  const created = await api('/api/auth/register', 'POST',
    { username, password, deviceId: 'isolated-direct-benchmark' })
  assert.equal(created.status, 201, 'register disposable test account')
  account = { token: created.value?.token, userId: created.value?.user?.userId }
  assert.ok(account.token && account.userId)
  let revision = 0
  // 3 samples per size; report each latency without smoothing tail failures.
  for (const kiB of [64, 256, 511]) {
    for (let sample = 1; sample <= 3; sample++) {
      const f = fixture(account.userId, revision, kiB)
      let posted
      try {
        posted = await api('/api/sync/v2/binary/direct', 'POST', f.bytes,
          account.token, {
            'Content-Type': 'application/octet-stream',
            'X-Qwerty-Payload-Sha256': sha(f.bytes),
            'X-Qwerty-Base-Revision': String(f.baseRevision),
            'X-Qwerty-Logical-Fingerprint': f.fingerprint,
            'X-Qwerty-Device-Id': 'isolated-direct-benchmark',
          })
      } catch (e) {
        console.error('ETEST_DIRECT_UNKNOWN_RESPONSE ' + JSON.stringify({
          targetKiB: kiB, sample, name: e?.name || 'network_error' }))
        throw e // never retry an ambiguous write
      }
      let verificationMs = null
      if (posted.status === 200) {
        verificationMs = await verifyCommitted(account.token, f)
        revision++
      } else {
        // Read remote revision for evidence, but NEVER replay failed commit.
        const m = await api('/api/sync/v2/meta', 'GET', undefined, account.token)
        console.error('ETEST_DIRECT_NON200 ' + JSON.stringify({
          status: posted.status, error: posted.value?.error || null,
          expectedRevision: revision + 1,
          observedRevision: m.value?.revision ?? null,
        }))
      }
      const row = { targetKiB: kiB, sample,
        compressedBytes: f.bytes.length, transmittedBytes: posted.requestBytes,
        httpMs: posted.httpMs, status: posted.status,
        revisionVerified: verificationMs !== null,
        verificationMs }
      console.log('ETEST_DIRECT_PERF ' + JSON.stringify(row))
      results.push(row)
      assert.equal(posted.status, 200, 'direct V4 upload must complete')
    }
  }
  for (const kiB of [64, 256, 511]) {
    const a = results.filter(r => r.targetKiB === kiB).map(r => r.httpMs)
      .sort((a, b) => a - b)
    console.log('ETEST_DIRECT_SUMMARY ' + JSON.stringify({
      targetKiB: kiB, count: a.length, minMs: a[0],
      p50Ms: a[Math.floor(a.length / 2)],
      sampleMaxMs: a.at(-1), errors: 0,
    }))
  }
} catch (e) {
  failure = e
} finally {
  if (account) {
    try {
      const del = await api('/api/auth/account', 'DELETE',
        { currentPassword: password }, account.token)
      assert.equal(del.status, 200)
      assert.equal(del.value?.deleted?.accountDeleted, true)
      console.log('ETEST_DIRECT_DISPOSABLE_CLEANUP PASS')
    } catch (e) {
      console.error('ETEST_DIRECT_DISPOSABLE_CLEANUP FAIL')
      failure ||= e
    }
  }
}
if (failure) throw failure
