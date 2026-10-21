/* eslint-env node */
/**
 * etest-only REAL CLOUD V4 merge writeback PILOT.
 *
 * Two authenticated devices on one DISPOSABLE account independently change
 * learning rows and settings. We merge only the PROVEN safe subset:
 * one device changes the complete six-table learning unit, the other ONLY
 * changes independent preferences. The actual cloud CAS writeback and exact
 * gzip/SHA/readback are tested. No live user/automatic app merge is enabled.
 *
 * This is NOT two independent FSRS histories merging. Both-side learning
 * mutations are explicitly rejected, and cloud old-revision CAS is exercised.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test', 'etest only')
assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
const origin = new URL(process.env.QWERTY_SYNC_BASE_URL || '')
assert.equal(origin.origin, 'https://etest.edgeone.dev', 'never test master')
const checksum = x => crypto.createHash('sha256').update(x).digest('hex')
const prefix = 'e2e_merge_' + process.env.GITHUB_RUN_ID + '_' +
  (process.env.GITHUB_RUN_ATTEMPT || '1')
const temp = mkdtempSync(join(tmpdir(), 'qwerty-merge-cloud-'))
const built = join(temp, 'candidate.mjs')
const here = fileURLToPath(new URL('../../', import.meta.url))
const names = ['achievementEvents', 'achievementStates', 'chapterRecords',
  'reviewRecords', 'reviewWordStates', 'wordRecords']

function sleep(ms) { return new Promise(done => setTimeout(done, ms)) }
async function api(path, token, method = 'GET', body, headers = {}) {
  const req = await fetch(new URL(path, origin), {
    method, headers: {
      Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
    cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(40_000),
  })
  const raw = await req.text()
  let response
  try { response = JSON.parse(raw) } catch { response = null }
  return { status: req.status, response }
}
function must(r, code, what) {
  assert.equal(r.status, code, what + ': HTTP ' + r.status +
    ' error=' + String(r.response?.error ?? 'none'))
  return r.response
}
function word(id, token) {
  return { id, attemptId: token, dict: 'test-dict', word: 'word-' + id,
    timeStamp: 1800000000 + id, chapter: 0, timing: [],
    wrongCount: 0, mistakes: {}, sourceMode: 'learn',
    learnItemKind: 'acquisition' }
}
function seed(accountId) {
  const tables = names.map(name => ({ name, schema: '++id' }))
  const data = names.map(tableName => ({
    tableName, inbound: true,
    rows: tableName === 'wordRecords'
      ? [word(1, crypto.randomUUID())] : [],
  }))
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: new Date().toISOString(),
      source: { kind: 'account', accountId } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1,
        data: { databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'test-dict', currentChapter: 0 },
    },
  }
}
async function metadata(token) {
  return must(await api('/api/sync/v2/meta', token), 200, 'sync meta')
}
async function readPinned(token, expectedRevision, expectedFingerprint) {
  const manifest = must(await api('/api/sync/v2/binary/manifest', token),
    200, 'pinned binary manifest')
  assert.equal(manifest.revision, expectedRevision, 'manifest CAS revision')
  assert.equal(manifest.logicalFingerprint, expectedFingerprint, 'manifest logical sha')
  assert.equal(manifest.payloadEncoding, 'binary')
  assert.ok(manifest.count >= 1 && manifest.count <= 64)
  const parts = []
  for (let index = 0; index < manifest.count; index++) {
    const selector = new URLSearchParams({
      revision: String(manifest.revision),
      sha: manifest.payloadSha256, index: String(index),
    })
    const response = await fetch(new URL(
      '/api/sync/v2/binary/part?' + selector, origin), {
      headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    assert.equal(response.status, 200, 'exact immutable Blob part')
    const part = Buffer.from(await response.arrayBuffer())
    assert.equal(checksum(part), manifest.partSha256s[index])
    parts.push(part)
  }
  const payload = Buffer.concat(parts)
  assert.equal(payload.length, manifest.sizeBytes)
  assert.equal(checksum(payload), manifest.payloadSha256)
  const verified = verifyCompressedV4(payload, userId, expectedFingerprint)
  return verified.snapshot
}
async function visibleRevision(token, expectedRevision, fingerprint) {
  // EdgeOne is eventually consistent; repeated READs do not create
  // additional writes or fabricate an acknowledged commit.
  for (let i = 0; i < 25; i++) {
    const observed = await metadata(token)
    if (observed.revision === expectedRevision &&
        observed.logicalFingerprint === fingerprint) return observed
    await sleep(1200)
  }
  throw Error('Cloud revision not consistently observed; no retry of writes')
}
async function upload(token, baseRevision, snapshot, fingerprint) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  assert.ok(bytes.length > 0 && bytes.length < 512 * 1024)
  assert.equal(verifyCompressedV4(bytes, userId, fingerprint).logicalFingerprint,
    fingerprint, 'server canonical V4 verification')
  // Fail closed on a 500/timeout: do not re-upload an ambiguous commit.
  return api('/api/sync/v2/binary/direct', token, 'POST', bytes, {
    'Content-Type': 'application/octet-stream',
    'X-Qwerty-Payload-Sha256': checksum(bytes),
    'X-Qwerty-Base-Revision': String(baseRevision),
    'X-Qwerty-Logical-Fingerprint': fingerprint,
  })
}

let user = null, userId = null, failure = null
try {
  await build({ entryPoints: [resolve(here, 'src/sync/v4-conservative-three-way.ts')],
    outfile: built, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(here, 'tsconfig.json') })
  const { previewConservativeThreeWayV4: inspect } =
    await import(pathToFileURL(built).href)
  const health = must(await api('/api/health'), 200, 'etest health')
  assert.equal(health.service, 'qwerty-sync-gateway')
  assert.ok(health.capabilities.includes('v4-binary-direct-512k-v1'))
  user = { username: prefix, password:
    'e2e-' + crypto.randomBytes(18).toString('hex'),
    firstDevice: 'qwerty-web-' + crypto.randomUUID(),
    secondDevice: 'qwerty-web-' + crypto.randomUUID() }
  const register = must(await api('/api/auth/register', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.firstDevice }), { 'Content-Type': 'application/json' }),
  201, 'register isolated account')
  userId = register.user.userId
  user.firstToken = register.token
  assert.ok(userId && user.firstToken)
  const login = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.secondDevice }), { 'Content-Type': 'application/json' }),
  200, 'second independent device login')
  assert.equal(login.user.userId, userId)
  user.secondToken = login.token
  assert.notEqual(user.firstDevice, user.secondDevice)
  assert.equal((await metadata(user.firstToken)).revision, 0)

  const ancestor = seed(userId)
  const baseFingerprint = checksumStable(ancestor)
  must(await upload(user.firstToken, 0, ancestor, baseFingerprint),
    200, 'disposable initial six-table V4 upload')
  await visibleRevision(user.secondToken, 1, baseFingerprint)
  const downloadedAncestor = await readPinned(user.secondToken, 1, baseFingerprint)
  assert.equal(checksumStable(downloadedAncestor), baseFingerprint)

  const local = structuredClone(downloadedAncestor)
  const remote = structuredClone(downloadedAncestor)
  const words = local.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows
  words.push(word(2, crypto.randomUUID()))
  // Independent second device edits UI preference only; no scheduler
  // conflict, no session split, no clone of local numeric IDs from B.
  remote.workspaceData.settings.values.pronunciation = 'uk'
  const localFingerprint = checksumStable(local)
  const remoteFingerprint = checksumStable(remote)
  assert.notEqual(localFingerprint, remoteFingerprint)
  must(await upload(user.secondToken, 1, remote, remoteFingerprint),
    200, 'device B independent preference write')
  await visibleRevision(user.firstToken, 2, remoteFingerprint)
  const serverRemote = await readPinned(user.firstToken, 2, remoteFingerprint)

  // Stale device A MUST NOT overwrite B's cloud revision.
  const stale = await upload(user.firstToken, 1, local, localFingerprint)
  assert.equal(stale.status, 409, 'stale device A must not overwrite B')
  const current = await visibleRevision(user.firstToken, 2, remoteFingerprint)
  assert.equal(current.logicalFingerprint, remoteFingerprint)

  const preview = await inspect({
    accountId: userId, pinnedAncestorFingerprint: baseFingerprint,
    ancestor: downloadedAncestor, local, remote: serverRemote,
  })
  assert.equal(preview.status, 'projected', preview.reason)
  assert.equal(preview.publishReady, false,
    'preview never gives general product auto-write permission')
  assert.equal(preview.tableSource, 'local')
  assert.equal(preview.settingsSources.pronunciation, 'remote')
  const merged = preview.candidate
  assert.equal(merged.workspaceData.database.data.data.length, 6)
  assert.equal(merged.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows.length, 2)
  assert.equal(merged.workspaceData.settings.values.pronunciation, 'uk')
  assert.equal(checksumStable(merged), preview.candidateFingerprint)
  // ONLY this disposable CI script is authorized to turn the read-only
  // candidate into a real CAS cloud write after both pinned reads.
  must(await upload(user.firstToken, 2, merged, preview.candidateFingerprint),
    200, 'etest disposable-account merged V4 writeback')
  await visibleRevision(user.secondToken, 3, preview.candidateFingerprint)
  const final = await readPinned(user.secondToken, 3, preview.candidateFingerprint)
  assert.equal(checksumStable(final), preview.candidateFingerprint)
  assert.equal(final.workspaceData.settings.values.pronunciation, 'uk')
  assert.deepEqual(final.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows.map(x => x.attemptId),
  words.map(x => x.attemptId))
  assert.equal(final.workspaceData.database.data.data.length, 6)

  const unsafeA = structuredClone(ancestor)
  const unsafeB = structuredClone(ancestor)
  unsafeA.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows.push(word(3, crypto.randomUUID()))
  unsafeB.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows.push(word(4, crypto.randomUUID()))
  const unsafe = await inspect({
    accountId: userId, pinnedAncestorFingerprint: baseFingerprint,
    ancestor, local: unsafeA, remote: unsafeB,
  })
  assert.equal(unsafe.status, 'blocked')
  assert.equal(unsafe.reason,
    'both-devices-changed-learning-unit-requires-fsrs-replay')
  assert.equal((await metadata(user.firstToken)).revision, 3)
  console.log('PASS etest: 2-device account, exact ancestor, stale CAS 409, safe-subset 6-table writeback, full readback, concurrent FSRS BLOCKED')
} catch (error) { failure = error }
finally {
  if (user) {
    // Never operate on non-disposable identity. If a server 5xx means
    // ambiguous deletion, reauthenticate before a bounded retry.
    try {
      await disposeIsolatedMergeAccount()
    } catch (e) {
      console.error('Disposable merge pilot account CLEANUP FAILURE')
      failure ||= e
    }
  }
  rmSync(temp, { recursive: true, force: true })
}
if (failure) throw failure

function checksumStable(snapshot) {
  const db = snapshot.workspaceData.database.data
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
  }
  const byKey = (values, key) => values.map(v => ({ v, key: stable(key(v)) }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(x => x.v)
  const sorted = {
    tables: byKey(db.tables, x => x.name),
    data: byKey(db.data.map(x => ({
      ...x, rows: byKey(x.rows, row => row),
    })), x => x.tableName),
  }
  const data = snapshot.workspaceData
  return checksum(stable({
    database: sorted, learnRuntime: data.learnRuntime,
    settings: data.settings, navigation: data.navigation,
  }))
}

async function disposeIsolatedMergeAccount() {
  assert.ok(user.username.startsWith('e2e_merge_'))
  let token = user.firstToken ?? user.secondToken
  if (token) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const deleted = await api('/api/auth/account', token, 'DELETE',
        JSON.stringify({ currentPassword: user.password }),
        { 'Content-Type': 'application/json' })
      if (deleted.status === 200 && deleted.response?.deleted?.accountDeleted) {
        token = null
        break
      }
      if (deleted.status < 500 || attempt === 1)
        throw Error('Disposal failed: HTTP ' + deleted.status)
      await sleep(1500)
      const recovered = await api('/api/auth/login', null, 'POST',
        JSON.stringify({ username: user.username, password: user.password,
          deviceId: user.firstDevice }),
        { 'Content-Type': 'application/json' })
      const identity = recovered.response?.user
      if (recovered.status !== 200 || identity?.userId !== userId ||
          !recovered.response?.token) throw Error('Ambiguous account deletion; cannot safely retry')
      token = recovered.response.token
    }
    if (token) throw Error('Disposable account cleanup was not acknowledged')
  }
}
