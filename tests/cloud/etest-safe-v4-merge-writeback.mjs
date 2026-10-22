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
 * The pilot now also tests independently observed Good/Again on the SAME
 * word with complete immutable events and verified per-device FSRS replay.
 * Old-revision CAS remains mandatory; protected session/achievement mutations
 * and incomplete histories still block. This is NOT enabled in user UI.
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
const disjointBuilt = join(temp, 'time-replay-candidate.mjs')
const fsrsBuilt = join(temp, 'fsrs-rebuild.mjs')
const here = fileURLToPath(new URL('../../', import.meta.url))
const names = ['achievementEvents', 'achievementStates', 'chapterRecords',
  'reviewRecords', 'reviewWordStates', 'wordRecords']

function sleep(ms) { return new Promise(done => setTimeout(done, ms)) }
async function api(path, token, method = 'GET', body, headers = {}) {
  // Login and immutable/metadata GET are safe to retry after a transient
  // EdgeOne POP failure. POST V4, registration and DELETE are NOT replayable:
  // a 5xx/timeout may conceal a committed write or a partial account delete.
  const retryable = (method === 'GET' ||
    (method === 'POST' && path === '/api/auth/login'))
  for (let attempt = 1; attempt <= (retryable ? 4 : 1); attempt++) {
    try {
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
      if (!retryable || ![429, 500, 502, 503, 504].includes(req.status) ||
          attempt === 4) return { status: req.status, response }
      console.log('Transient etest read/login error; bounded retry', path,
        'HTTP', req.status, attempt)
    } catch (error) {
      if (!retryable || attempt === 4) throw error
      console.log('Transient etest read/login network error; bounded retry',
        path, attempt)
    }
    await sleep(700 * attempt)
  }
  throw Error('unreachable test transport state')
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
  await Promise.all([
    build({ entryPoints: [resolve(here, 'src/sync/v4-conservative-three-way.ts')],
      outfile: built, bundle: true, platform: 'node', format: 'esm',
      target: 'node20', tsconfig: resolve(here, 'tsconfig.json') }),
    build({ entryPoints: [resolve(here, 'src/sync/v4-disjoint-word-candidate.ts')],
      outfile: disjointBuilt, bundle: true, platform: 'node', format: 'esm',
      target: 'node20', tsconfig: resolve(here, 'tsconfig.json') }),
    build({ entryPoints: [resolve(here, 'src/review/fsrs/active.ts')],
      outfile: fsrsBuilt, bundle: true, platform: 'node', format: 'esm',
      target: 'node20', tsconfig: resolve(here, 'tsconfig.json') }),
  ])
  const { previewConservativeThreeWayV4: inspect } =
    await import(pathToFileURL(built).href)
  const { previewDisjointWordV4: mergeChronologically } =
    await import(pathToFileURL(disjointBuilt).href)
  const { rebuildActiveFsrsStateFromWordRecords: replayFsrs } =
    await import(pathToFileURL(fsrsBuilt).href)
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
  assert.notEqual(user.firstDevice, user.secondDevice)
  assert.equal((await metadata(user.firstToken)).revision, 0)

  const ancestor = seed(userId)
  const baseFingerprint = checksumStable(ancestor)
  must(await upload(user.firstToken, 0, ancestor, baseFingerprint),
    200, 'disposable initial six-table V4 upload')
  await visibleRevision(user.firstToken, 1, baseFingerprint)
  // Take independent device B online AFTER A has captured its working copy.
  // This works both in M1 multi-session mode and in the production-style
  // single-active-session fallback (B invalidates A's old token).
  const login = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.secondDevice }), { 'Content-Type': 'application/json' }),
  200, 'second device login')
  assert.equal(login.user.userId, userId)
  user.secondToken = login.token
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
  await visibleRevision(user.secondToken, 2, remoteFingerprint)
  // Re-authenticate device A after its offline work. A's obsolete local
  // revision is still 1. Never assume single-active-session allows both
  // bearer tokens to stay live until M1 is enabled on etest.
  const resumeA = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.firstDevice }), { 'Content-Type': 'application/json' }),
  200, 'device A reconnect')
  assert.equal(resumeA.user.userId, userId)
  user.firstToken = resumeA.token
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
  await visibleRevision(user.firstToken, 3, preview.candidateFingerprint)
  // A second independent device must download the resulting full V4 and
  // verify all six tables, not trust the publisher's own local copy.
  const resumeB = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.secondDevice }), { 'Content-Type': 'application/json' }),
  200, 'device B post-merge readback')
  assert.equal(resumeB.user.userId, userId)
  user.secondToken = resumeB.token
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
  assert.equal((await metadata(user.secondToken)).revision, 3)

  // M2.14: two REAL independent reviews on the SAME word, minutes apart or
  // the SAME second. Neither is discarded merely for sharing an FSRS base.
  // The first current V4 is an EXACT cloud-pinned common ancestor.
  const twoDeviceBase = final
  const commonHash = checksumStable(twoDeviceBase)
  const studyA = structuredClone(twoDeviceBase)
  const studyB = structuredClone(twoDeviceBase)
  const rowsOf = (snap, name) => snap.workspaceData.database.data.data.find(
    entry => entry.tableName === name).rows
  const reviewAId = crypto.randomUUID(), reviewBId = crypto.randomUUID()
  const rating = (uuid, text, timeStamp) => ({
    ...word(3, uuid), dict: 'test-dict', word: 'word-1', chapter: -1,
    learnItemKind: 'review', timeStamp,
    reviewBaseStateFingerprint: 'd'.repeat(64),
    reviewRatingDecision: { eligible: true, rating: text,
      confidence: 1, reasonCodes: ['test'] },
  })
  rowsOf(studyA, 'wordRecords').push(rating(reviewAId, 'good', 1800090000))
  rowsOf(studyB, 'wordRecords').push(rating(reviewBId, 'again', 1800090000))
  for (const branch of [studyA, studyB]) {
    const state = replayFsrs('test-dict', 'word-1',
      rowsOf(branch, 'wordRecords').filter(r => r.word === 'word-1'))
    assert.equal(state?.reviewCount, 1, 'each branch has one genuine FSRS rating')
    rowsOf(branch, 'reviewWordStates').push({ ...state, id: 1 })
  }
  const branchHash = checksumStable(studyB)
  must(await upload(user.secondToken, 3, studyB, branchHash),
    200, 'device B publishes own Same-Word Again evidence')
  await visibleRevision(user.secondToken, 4, branchHash)
  const switchA = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.firstDevice }), { 'Content-Type': 'application/json' }),
  200, 'device A reconnect after same-word offline review')
  assert.equal(switchA.user.userId, userId)
  user.firstToken = switchA.token
  assert.equal((await upload(user.firstToken, 3, studyA, checksumStable(studyA))).status,
    409, 'device A stale revision 3 must never overwrite B')
  const witnessedB = await readPinned(user.firstToken, 4, branchHash)
  const twoGrades = await mergeChronologically({
    accountId: userId, pinnedAncestorFingerprint: commonHash,
    ancestor: twoDeviceBase, local: studyA, remote: witnessedB,
  })
  assert.equal(twoGrades.status, 'projected', twoGrades.reason)
  assert.equal(twoGrades.chronologicallyReplayedWords, 1)
  assert.equal(twoGrades.publishReady, false)
  assert.equal(twoGrades.convergenceComplete, false)
  const mergedWord = rowsOf(twoGrades.candidate, 'wordRecords')
    .filter(x => x.word === 'word-1')
  assert.equal(mergedWord.length, 3, 'original + Good + Again all kept')
  assert.deepEqual(new Set(mergedWord.map(x => x.attemptId)),
    new Set([rowsOf(twoDeviceBase, 'wordRecords')[0].attemptId,
      reviewAId, reviewBId]))
  const mergedState = rowsOf(twoGrades.candidate, 'reviewWordStates')
    .find(x => x.word === 'word-1')
  assert.equal(mergedState.reviewCount, 2, 'both actual reviews feed FSRS')
  const recomputed = replayFsrs('test-dict','word-1',mergedWord)
  assert.equal(mergedState.nextReviewAt, recomputed.nextReviewAt)
  assert.equal(mergedState.schedulerState.stability, recomputed.schedulerState.stability)
  must(await upload(user.firstToken, 4, twoGrades.candidate,
    twoGrades.candidateFingerprint), 200,
  'etest disposable same-word BOTH grades six-table V4 CAS writeback')
  await visibleRevision(user.firstToken, 5, twoGrades.candidateFingerprint)
  const switchB = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.secondDevice }), { 'Content-Type': 'application/json' }),
  200, 'device B reads merged FSRS state')
  user.secondToken = switchB.token
  const verified = await readPinned(user.secondToken, 5, twoGrades.candidateFingerprint)
  assert.equal(checksumStable(verified), twoGrades.candidateFingerprint)
  assert.equal(rowsOf(verified,'reviewWordStates').find(r => r.word === 'word-1').reviewCount,2)
  assert.equal(new Set(rowsOf(verified, 'wordRecords')
    .filter(x => x.word === 'word-1').map(r => r.attemptId)).size,3)
  // A separate real-cloud six-table round trip for the NEW ReviewSession
  // three-way merge. Both devices independently create session UUIDs with the
  // SAME local numeric ID. No historical word/FSRS rows are discarded.
  const sessionA = structuredClone(verified)
  const sessionB = structuredClone(verified)
  const sessionsOf = snap => rowsOf(snap, 'reviewRecords')
  const newSession = (sessionId) => ({
    id: 1, sessionId, dict: 'test-dict', index: 0,
    createTime: 1800096000, isFinished: false,
    sessionKind: 'review',
    words: [{ name: 'word-1', trans: ['test'] }],
  })
  const sessionUuidA = crypto.randomUUID()
  const sessionUuidB = crypto.randomUUID()
  sessionsOf(sessionA).push(newSession(sessionUuidA))
  sessionsOf(sessionB).push(newSession(sessionUuidB))
  const sessionRemoteSha = checksumStable(sessionB)
  must(await upload(user.secondToken, 5, sessionB, sessionRemoteSha),
    200, 'device B independently publishes ReviewSession')
  await visibleRevision(user.secondToken, 6, sessionRemoteSha)
  const loginSessionA = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.firstDevice }), { 'Content-Type': 'application/json' }),
  200, 'device A independently reconnects for ReviewSession replay')
  user.firstToken = loginSessionA.token
  assert.equal((await upload(user.firstToken, 5, sessionA,
    checksumStable(sessionA))).status, 409,
  'stale ReviewSession must not overwrite the independent device')
  const sessionPinnedB = await readPinned(user.firstToken, 6, sessionRemoteSha)
  const sessionProjection = await mergeChronologically({
    accountId: userId, pinnedAncestorFingerprint: twoGrades.candidateFingerprint,
    ancestor: verified, local: sessionA, remote: sessionPinnedB,
  })
  assert.equal(sessionProjection.status, 'projected', sessionProjection.reason)
  assert.deepEqual(new Set(sessionsOf(sessionProjection.candidate)
    .map(s => s.sessionId)), new Set([sessionUuidA, sessionUuidB]))
  assert.deepEqual(sessionsOf(sessionProjection.candidate)
    .map(s => s.id), [1, 2], 'colliding local numeric session IDs rekeyed')
  assert.equal(rowsOf(sessionProjection.candidate, 'wordRecords').length,
    rowsOf(verified, 'wordRecords').length)
  must(await upload(user.firstToken, 6,
    sessionProjection.candidate, sessionProjection.candidateFingerprint),
  200, 'disposable six-table ReviewSession V4 CAS writeback')
  await visibleRevision(user.firstToken, 7, sessionProjection.candidateFingerprint)
  const loginSessionB = must(await api('/api/auth/login', null, 'POST',
    JSON.stringify({ username: user.username, password: user.password,
      deviceId: user.secondDevice }), { 'Content-Type': 'application/json' }),
  200, 'device B reads merged ReviewSessions')
  user.secondToken = loginSessionB.token
  const finalSessions = await readPinned(user.secondToken, 7,
    sessionProjection.candidateFingerprint)
  assert.deepEqual(new Set(sessionsOf(finalSessions).map(s => s.sessionId)),
    new Set([sessionUuidA, sessionUuidB]))
  assert.equal(checksumStable(finalSessions), sessionProjection.candidateFingerprint)
  console.log('PASS etest: real V4 Blob CAS, old revision 409, six-table safe subset; two SAME-word Good/Again attempts, stable chronological FSRS replay, real commit and independent-device readback')
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
  let token = user.secondToken ?? user.firstToken
  if (token) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const deleted = await api('/api/auth/account', token, 'DELETE',
        JSON.stringify({ currentPassword: user.password }),
        { 'Content-Type': 'application/json' })
      if (deleted.status === 200 && deleted.response?.deleted?.accountDeleted) {
        token = null
        break
      }
      if (deleted.status < 500 || attempt === 3)
        throw Error('Disposal failed: HTTP ' + deleted.status)
      await sleep(1500 * (attempt + 1))
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
