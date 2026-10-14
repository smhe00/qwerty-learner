/* eslint-env node */
/**
 * Explicit opt-in real-site comparison, no code deployment to master.
 * Only newly registered disposable accounts are written or deleted.
 * A failed/unknown commit is NEVER retried. The same high-entropy fixture
 * is sent to the legacy Base64 master and the native-binary etest gateway.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../cloud-functions/_shared/sync-v4.js'

if (process.env.V4_BENCHMARK_ACK !== 'RUN_DISPOSABLE_MASTER_VS_ETEST_BENCHMARK') {
  throw Error('V4 benchmark requires explicit disposable-production-test acknowledgement')
}
const targets = [
  { label: 'master', url: 'https://qwerty-plus.edgeone.dev/', binary: false },
  { label: 'etest', url: 'https://etest.edgeone.dev/', binary: true },
]
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const perf = () => performance.now()
const round = x => Math.round(x)
const identity = 'v4bench' + Date.now().toString(36) +
  crypto.randomBytes(2).toString('hex')
const rows = []
const snapshots = new Map()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function request(target, path, method = 'GET', body, token, extraHeaders) {
  const headers = { Accept: 'application/json', ...extraHeaders }
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined && !extraHeaders?.['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const outgoing = body === undefined ? undefined :
    Buffer.isBuffer(body) ? body : JSON.stringify(body)
  const started = perf()
  const response = await fetch(new URL(path, target.url), {
    method, headers, body: outgoing, redirect: 'error',
    signal: AbortSignal.timeout(45000),
  })
  const raw = await response.text()
  let value
  try { value = JSON.parse(raw) } catch { value = {} }
  return { status: response.status, value, ms: round(perf() - started),
    wireBytes: outgoing?.length || 0 }
}
async function register(target) {
  const user = {
    username: identity + (target.binary ? 'e' : 'm'),
    password: crypto.randomBytes(16).toString('base64url'),
  }
  const reply = await request(target, '/api/auth/register', 'POST',
    { ...user, deviceId: 'disposable-latency-benchmark' })
  assert.equal(reply.status, 201, target.label + ' disposable register ' + reply.status)
  user.userId = reply.value?.user?.userId
  user.token = reply.value?.token
  assert.ok(user.userId && user.token)
  target.disposable = user
  target.revision = 0
}
function makeFixture(user, revision, highEntropy) {
  const tableNames = ['achievementEvents', 'achievementStates', 'chapterRecords',
    'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = tableNames.map(name => ({ name, schema: '++id' }))
  const data = tableNames.map(name => ({
    tableName: name, inbound: true,
    rows: name === 'wordRecords'
      ? [{ id: 1, word: 'bench-only',
        typingTelemetry: { synthetic: highEntropy.toString('base64') } }] : [],
  }))
  const workspaceData = {
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6, tables, data,
    } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'bench-dict', currentChapter: 0 },
  }
  const fingerprint = sha(stable({
    database: { tables, data },
    learnRuntime: workspaceData.learnRuntime,
    settings: workspaceData.settings,
    navigation: workspaceData.navigation,
  }))
  const snapshot = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-15T00:00:00.000Z',
      source: { kind: 'account', accountId: user.userId } },
    workspaceData,
  }
  const bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  assert.equal(verifyCompressedV4(bytes, user.userId, fingerprint)
    .logicalFingerprint, fingerprint)
  return { bytes, fingerprint, baseRevision: revision,
    clientFormatVersion: 'qwerty-backup-v4' }
}
async function uploadMaster(target, fixture) {
  return request(target, '/api/sync/v2', 'PUT', {
    baseRevision: fixture.baseRevision,
    logicalFingerprint: fixture.fingerprint,
    payloadBase64: fixture.bytes.toString('base64'),
    clientFormatVersion: fixture.clientFormatVersion,
    deviceId: 'disposable-latency-benchmark',
  }, target.disposable.token)
}
async function uploadDirect(target, fixture) {
  return request(target, '/api/sync/v2/binary/direct', 'POST', fixture.bytes,
    target.disposable.token, {
      'Content-Type': 'application/octet-stream',
      'X-Qwerty-Payload-Sha256': sha(fixture.bytes),
      'X-Qwerty-Base-Revision': String(fixture.baseRevision),
      'X-Qwerty-Logical-Fingerprint': fixture.fingerprint,
      'X-Qwerty-Device-Id': 'disposable-latency-benchmark',
    })
}
async function uploadStaged(target, fixture) {
  const b = fixture.bytes
  const n = Math.ceil(b.length / (512 * 1024))
  const partHashes = Array.from({ length: n }, (_, i) =>
    sha(b.subarray(i * 512 * 1024, (i + 1) * 512 * 1024)))
  let next = 0
  let failure
  let attempts = 0
  let retry503 = 0
  let wireBytes = 0
  const worker = async () => {
    while (!failure && next < n) {
      const i = next++
      const data = b.subarray(i * 512 * 1024, (i + 1) * 512 * 1024)
      for (let retry = 0; retry < 6; retry++) {
        let reply
        try {
          reply = await request(target, '/api/sync/v2/parts', 'POST', data,
            target.disposable.token, {
              'Content-Type': 'application/octet-stream',
              'X-Qwerty-Payload-Sha256': sha(b),
              'X-Qwerty-Part-Sha256': partHashes[i],
              'X-Qwerty-Part-Index': String(i),
              'X-Qwerty-Part-Count': String(n),
              'X-Qwerty-Chunk-Bytes': String(512 * 1024),
            })
        } catch (error) {
          reply = { status: 503, value: { error: 'transport_error' }, wireBytes: data.length }
        }
        attempts++
        wireBytes += reply.wireBytes
        if (reply.status === 200 && reply.value?.received &&
            reply.value.payloadSha256 === sha(b) &&
            reply.value.partSha256 === partHashes[i] &&
            reply.value.index === i) break
        if (reply.status === 503) retry503++
        if (reply.status < 500 || retry === 5) {
          failure ||= Error('immutable part ' + i + ' failed HTTP ' +
            reply.status + ' ' + (reply.value?.error || 'unknown'))
          break
        }
        await delay([150, 350, 750, 1500, 3000][retry])
      }
    }
  }
  const started = perf()
  await Promise.all(Array.from({ length: Math.min(3, n) }, () => worker()))
  if (failure) return { status: 503, value: { error: 'staging_failed' },
    ms: round(perf() - started), wireBytes, partAttempts: attempts, retry503 }
  const commit = await request(target, '/api/sync/v2/commit', 'POST', {
    baseRevision: fixture.baseRevision,
    logicalFingerprint: fixture.fingerprint,
    clientFormatVersion: fixture.clientFormatVersion,
    deviceId: 'disposable-latency-benchmark',
    payloadSha256: sha(b),
    partSha256s: partHashes, wirePartBytes: 512 * 1024, count: n,
  }, target.disposable.token)
  return { ...commit, ms: round(perf() - started),
    wireBytes: wireBytes + commit.wireBytes, partAttempts: attempts, retry503 }
}
async function verifyReadback(target, fixture) {
  const token = target.disposable.token
  const meta = await request(target, '/api/sync/v2/meta', 'GET', undefined, token)
  if (meta.status !== 200 || meta.value?.revision !== fixture.baseRevision + 1 ||
      meta.value?.payloadSha256 !== sha(fixture.bytes) ||
      meta.value?.logicalFingerprint !== fixture.fingerprint) {
    return { ok: false, observedRevision: meta.value?.revision ?? null,
      observedShaMatch: meta.value?.payloadSha256 === sha(fixture.bytes) }
  }
  if (!target.binary) {
    const reply = await request(target, '/api/sync/v2', 'GET', undefined, token)
    const read = reply.value?.payloadBase64
    return { ok: reply.status === 200 && typeof read === 'string' &&
      Buffer.from(read, 'base64').equals(fixture.bytes) }
  }
  const manifest = await request(target, '/api/sync/v2/binary/manifest',
    'GET', undefined, token)
  if (manifest.status !== 200 || manifest.value?.payloadSha256 !== sha(fixture.bytes)) {
    return { ok: false, stage: 'binary_manifest' }
  }
  const parts = []
  for (let i = 0; i < manifest.value.count; i++) {
    const qs = new URLSearchParams({
      revision: String(manifest.value.revision), sha: sha(fixture.bytes),
      index: String(i),
    })
    const rsp = await fetch(new URL('/api/sync/v2/binary/part?' + qs, target.url), {
      headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
      signal: AbortSignal.timeout(45000),
    })
    if (rsp.status !== 200) return { ok: false, stage: 'binary_part_' + i }
    const part = Buffer.from(await rsp.arrayBuffer())
    if (sha(part) !== manifest.value.partSha256s[i]) {
      return { ok: false, stage: 'binary_part_sha_' + i }
    }
    parts.push(part)
  }
  return { ok: Buffer.concat(parts).equals(fixture.bytes) }
}
async function preflight(target) {
  const result = await request(target, '/api/health')
  assert.equal(result.status, 200, target.label + ' health')
  const capabilities = result.value?.capabilities || []
  assert.ok(capabilities.includes('backup-v4-authenticated-write-ga'),
    target.label + ' V4 gateway missing')
  if (target.binary) {
    assert.ok(capabilities.includes('v4-end-to-end-binary-v1'),
      'etest native binary gateway missing')
    assert.ok(capabilities.includes('v4-binary-direct-512k-v1'),
      'etest one-request fast path not yet deployed')
  } else {
    assert.ok(!capabilities.includes('v4-end-to-end-binary-v1'),
      'master is no longer the historical Base64-only release; STOP')
  }
}
for (const target of targets) await preflight(target)
let failed
try {
  for (const target of targets) await register(target)
  const sizesKiB = [256, 1024, 1536, 2048]
  for (let j = 0; j < sizesKiB.length; j++) {
    const entropy = crypto.randomBytes(sizesKiB[j] * 1024)
    // Alternate order so transient EdgeOne/POP load is less systematic.
    const order = j % 2 ? [...targets].reverse() : targets
    const measurements = []
    for (const target of order) {
      if (target.blocked) continue
      const fixture = makeFixture(target.disposable, target.revision, entropy)
      const started = perf()
      let upload
      try {
        upload = target.binary
          ? (fixture.bytes.length <= 512 * 1024
            ? await uploadDirect(target, fixture) : await uploadStaged(target, fixture))
          : await uploadMaster(target, fixture)
      } catch (error) {
        upload = { status: 0, value: { error: error?.name || 'network_error' },
          ms: round(perf() - started) }
      }
      const observed = await verifyReadback(target, fixture).catch(error =>
        ({ ok: false, stage: 'readback_' + (error?.name || 'error') }))
      const record = { target: target.label, sourceKiB: sizesKiB[j],
        gzipBytes: fixture.bytes.length,
        wireBytes: upload.wireBytes ?? null, writeMs: upload.ms,
        httpStatus: upload.status, error: upload.value?.error || null,
        partAttempts: upload.partAttempts ?? null, retry503: upload.retry503 ?? null,
        shaVerified: observed.ok,
        observedRevision: observed.observedRevision ?? null,
      }
      console.log('V4_COMPARISON ' + JSON.stringify(record))
      rows.push(record)
      measurements.push(record)
      if (upload.status !== 200 || !observed.ok) {
        target.blocked = true
        console.error('BENCH_SITE_STOP: fail-closed, no retry of ambiguous final commit: ' +
          target.label + ' @ ' + sizesKiB[j] + ' KiB')
      } else {
        target.revision += 1
      }
    }
    if (measurements.length === 2) {
      assert.ok(Math.abs(measurements[0].gzipBytes -
        measurements[1].gzipBytes) <= 128,
      'Comparable high-entropy fixture lengths unexpectedly differ')
    }
  }
  console.log('V4_COMPARISON_SUMMARY ' + JSON.stringify(rows))
} catch (error) {
  failed = error
} finally {
  for (const target of targets) {
    if (!target.disposable) continue
    try {
      const deleted = await request(target, '/api/auth/account', 'DELETE',
        { currentPassword: target.disposable.password }, target.disposable.token)
      if (deleted.status !== 200 || deleted.value?.deleted?.accountDeleted !== true) {
        throw Error('Account deletion unconfirmed HTTP ' + deleted.status)
      }
      console.log('BENCH_ACCOUNT_CLEANUP ' + target.label + ': PASS')
    } catch (error) {
      console.error('BENCH_ACCOUNT_CLEANUP ' + target.label + ': FAILED')
      failed ||= error
    }
  }
}
if (failed) throw failed
