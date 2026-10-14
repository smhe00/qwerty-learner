/* eslint-env node */
// One-shot, master-only production benchmark. No retries or existing accounts.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { appendFileSync, writeFileSync } from 'node:fs'
import { verifyCompressedV4 } from '../cloud-functions/_shared/sync-v4.js'
const EXPECTED_MASTER = '35134ca027dd55291e989bf63b4c776bd2668865'
const ORIGIN = 'https://qwerty-plus.edgeone.dev'
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const clock = () => performance.now()
const ms = t => Math.round((clock() - t) * 100) / 100
const rows = []
let owned = null
let cleanup = null
let failure = null
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
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

function sizedFixture(user, revision, targetBytes) {
  // Tune entropy length offline; never send tuning requests to production.
  let length = targetBytes
  let result
  for (let attempt = 0; attempt < 12; attempt++) {
    result = makeFixture(user, revision, crypto.randomBytes(length))
    if (Math.abs(result.bytes.length - targetBytes) <= 128) {
      return { ...result, entropyBytes: length, targetBytes }
    }
    length = Math.max(1, length + targetBytes - result.bytes.length)
  }
  throw Error('Unable to generate requested gzip size within 128 bytes')
}
async function request(path, method = 'GET', body, token) {
  assert.ok(['/api/health', '/api/auth/register', '/api/auth/me',
    '/api/auth/account', '/api/sync/v2/meta', '/api/sync/v2'].includes(path))
  if (token) assert.ok(owned && token === owned.token)
  if (method === 'DELETE') assert.ok(owned && owned.createdHere &&
    path === '/api/auth/account' && body.currentPassword === owned.password)
  const outgoing = body === undefined ? undefined : JSON.stringify(body)
  const headers = { Accept: 'application/json', 'Cache-Control': 'no-cache' }
  if (outgoing !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = 'Bearer ' + token
  const started = clock()
  let status = 0
  try {
    const response = await fetch(ORIGIN + path, {
      method, headers, body: outgoing, redirect: 'error',
      signal: AbortSignal.timeout(60000),
    })
    status = response.status
    const raw = await response.text()
    let value
    try { value = JSON.parse(raw) } catch { value = null }
    return { status, value, ms: ms(started),
      jsonBytes: outgoing === undefined ? 0 : Buffer.byteLength(outgoing),
      error: value ? null : 'non_json_response' }
  } catch (error) {
    return { status, value: null, ms: ms(started),
      jsonBytes: outgoing === undefined ? 0 : Buffer.byteLength(outgoing),
      error: error.name }
  }
}
async function preflight() {
  assert.equal(process.env.V4_MASTER_BENCH_ACK, 'MASTER_ONLY_DISPOSABLE_35134ca0')
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'One-shot run: reruns disabled')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/master-v4-once-20261015')
  const ref = await fetch('https://api.github.com/repos/smhe00/qwerty-learner/git/ref/heads/master', {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  assert.equal(ref.status, 200)
  assert.equal((await ref.json()).object.sha, EXPECTED_MASTER)
  const html = await fetch(ORIGIN + '/?v4-bench=' + process.env.GITHUB_RUN_ID,
    { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert.equal(html.status, 200)
  const text = await html.text()
  const assets = [...text.matchAll(/src=["'](\/assets\/[^"']+\.js)["']/g)].map(x => x[1])
  assert.ok(assets.length)
  let assetPinned = false
  const visited = new Set()
  const queue = [...assets]
  while (queue.length && visited.size < 100 && !assetPinned) {
    const path = queue.shift()
    if (visited.has(path)) continue
    visited.add(path)
    const response = await fetch(ORIGIN + path, {
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    assert.equal(response.status, 200)
    const js = await response.text()
    if (js.includes(EXPECTED_MASTER.slice(0, 7))) assetPinned = true
    console.log('MASTER_ASSET_CHECK ' + JSON.stringify({ path, bytes: Buffer.byteLength(js), expectedStamp: assetPinned }))
    for (const match of js.matchAll(/["']((?:\.\/|\/?assets\/)[A-Za-z0-9_.-]+\.js)["']/g)) {
      const child = new URL(match[1], ORIGIN + path)
      if (child.origin === ORIGIN && child.pathname.startsWith('/assets/') &&
          !visited.has(child.pathname)) queue.push(child.pathname)
    }
    if (js.includes('Version')) {
      console.log('MASTER_ASSET_VERSION_CONTEXT ' + JSON.stringify(js.match(/.{0,80}Version.{0,160}/g)?.slice(0,4)))
    }
  }
  assert.ok(assetPinned, 'Loaded production JS must contain master release stamp')
  const health = await request('/api/health')
  assert.equal(health.status, 200)
  assert.ok(health.value?.capabilities?.includes('backup-v4-authenticated-write-ga'))
  assert.ok(!health.value.capabilities.includes('v4-end-to-end-binary-v1'))
  console.log('MASTER_PREFLIGHT ' + JSON.stringify({ expectedMaster: EXPECTED_MASTER,
    benchmarkCommit: process.env.GITHUB_SHA, assetPinned, healthStatus: health.status }))
}
async function run() {
  await preflight()
  const username = 'v4once' + process.env.GITHUB_RUN_ID + crypto.randomBytes(4).toString('hex')
  assert.ok(username.length <= 32)
  const password = crypto.randomBytes(24).toString('base64url')
  const registration = await request('/api/auth/register', 'POST', {
    username, password, deviceId: 'disposable-master-v4-once',
  })
  // Save only credentials returned by THIS registration, before validation.
  if (registration.value?.token && registration.value?.user?.userId &&
      registration.value.user.username === username) {
    owned = { username, password, token: registration.value.token,
      userId: registration.value.user.userId, createdHere: true }
    console.log('::add-mask::' + password)
    console.log('::add-mask::' + owned.token)
  }
  assert.equal(registration.status, 201, 'Registration failed; never login to an existing account')
  assert.ok(owned, 'Registration identity unconfirmed; STOP')
  console.log('DISPOSABLE_ACCOUNT_CREATED ' + JSON.stringify({ username, userId: owned.userId }))
  const initial = await request('/api/sync/v2/meta', 'GET', undefined, owned.token)
  assert.equal(initial.status, 200)
  assert.equal(initial.value.revision, 0)
  assert.equal(initial.value.hasData, false)
  let revision = 0
  for (const targetKiB of [256, 1024, 1536, 2048]) {
    const f = sizedFixture(owned, revision, targetKiB * 1024)
    const expectedSha = sha(f.bytes)
    const put = await request('/api/sync/v2', 'PUT', {
      baseRevision: revision, logicalFingerprint: f.fingerprint,
      payloadBase64: f.bytes.toString('base64'),
      clientFormatVersion: 'qwerty-backup-v4', deviceId: 'disposable-master-v4-once',
    }, owned.token)
    // Exactly one metadata read after every PUT, including unknown outcome.
    const verifyStarted = clock()
    const meta = await request('/api/sync/v2/meta', 'GET', undefined, owned.token)
    const metaMatch = meta.status === 200 && meta.value?.revision === revision + 1 &&
      meta.value.payloadSha256 === expectedSha && meta.value.logicalFingerprint === f.fingerprint &&
      meta.value.sizeBytes === f.bytes.length
    const ackMatch = put.status === 200 && put.value?.revision === revision + 1 &&
      put.value.payloadSha256 === expectedSha && put.value.logicalFingerprint === f.fingerprint
    let readback = null
    let bytesMatch = false
    // Ambiguous PUTs stop after metadata: no further readback or upload.
    if (ackMatch && metaMatch) {
      readback = await request('/api/sync/v2', 'GET', undefined, owned.token)
      const b64 = readback.value?.payloadBase64
      bytesMatch = readback.status === 200 && readback.value.revision === revision + 1 &&
        readback.value.payloadSha256 === expectedSha && typeof b64 === 'string' &&
        Buffer.from(b64, 'base64').equals(f.bytes)
      if (bytesMatch) verifyCompressedV4(Buffer.from(b64, 'base64'), owned.userId, f.fingerprint)
    }
    const row = {
      targetKiB, entropyBytes: f.entropyBytes, gzipBytes: f.bytes.length,
      base64Bytes: 4 * Math.ceil(f.bytes.length / 3), base64JsonBytes: put.jsonBytes,
      putMs: put.ms, statusCode: put.status, error: put.error || put.value?.error || null,
      expectedRevision: revision + 1, ackRevision: put.value?.revision ?? null,
      observedRevision: meta.value?.revision ?? null, expectedSha256: expectedSha,
      observedSha256: meta.value?.payloadSha256 ?? null,
      logicalFingerprint: f.fingerprint, metaStatus: meta.status, metaMs: meta.ms,
      metaMatch, readbackStatus: readback?.status ?? null, readbackMs: readback?.ms ?? null,
      verificationMs: ms(verifyStarted), shaReadbackVerified: bytesMatch,
      stopped: !(ackMatch && metaMatch && bytesMatch), putAttempts: 1,
    }
    rows.push(row)
    console.log('MASTER_V4_RESULT ' + JSON.stringify(row))
    if (row.stopped) {
      throw Error('PUT/readback failed or ambiguous; metadata recorded; STOP without retry')
    }
    revision++
  }
}
try { await run() } catch (error) {
  failure = error.message
  console.error('MASTER_BENCH_STOP ' + failure)
} finally {
  if (owned) {
    // Verify token identity before deleting only the newly created account.
    const me = await request('/api/auth/me', 'GET', undefined, owned.token)
    if (me.status === 200 && me.value?.user?.userId === owned.userId &&
        me.value.user.username === owned.username) {
      const deleted = await request('/api/auth/account', 'DELETE',
        { currentPassword: owned.password }, owned.token)
      const gone = await request('/api/auth/me', 'GET', undefined, owned.token)
      cleanup = { username: owned.username, userId: owned.userId,
        deleteStatus: deleted.status, accountDeleted: deleted.value?.deleted?.accountDeleted === true,
        postDeleteMeStatus: gone.status,
        confirmed: deleted.status === 200 && deleted.value?.deleted?.accountDeleted === true &&
          gone.status === 401 }
    } else {
      cleanup = { confirmed: false, reason: 'identity_check_failed', status: me.status }
    }
    console.log('MASTER_ACCOUNT_CLEANUP ' + JSON.stringify(cleanup))
    if (!cleanup.confirmed) failure ||= 'Disposable account deletion unconfirmed'
  }
  const result = { productionMaster: EXPECTED_MASTER, benchmarkCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, target: ORIGIN, rows, cleanup, failure }
  writeFileSync('master-v4-benchmark-results.json', JSON.stringify(result, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '# Master V4 Base64 one-shot benchmark\n\n```json\n' +
    JSON.stringify(result, null, 2) + '\n```\n')
}
if (failure) process.exitCode = 1
