/* eslint-env node */
// P4b data-preserving Maker rollback trial. This file runs only in CI.
// Disposable test13 V4 write under short-lived trial backend, then wait for
// strict Maker release, verify SAME V4 record and V1 downgrade rejection.
// No tokens, credentials or learning words are logged.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

const base = new URL('https://qwerty-plus.edgeone.dev/')
const marker = 'p4b-rollback-data-seed-v1'
const username = 'test13'
const password = crypto.randomBytes(24).toString('base64url')
const tables = ['achievementEvents','achievementStates','chapterRecords',
  'reviewRecords','reviewWordStates','wordRecords']
let token = null
let created = false
let failure = null
const sha = x => crypto.createHash('sha256').update(x).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort()
    .filter(k => value[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
}
async function api(path, method = 'GET', body, auth = token) {
  const headers = { Accept: 'application/json' }
  if (auth) headers.Authorization = 'Bearer ' + auth
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(new URL(path, base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(25000),
  })
  const data = await res.json()
  return { status: res.status, data }
}
async function status(context, state, description) {
  const githubToken = process.env.GH_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  const commit = process.env.GITHUB_SHA
  if (!githubToken || !repository || !commit) throw new Error('Missing CI status credentials')
  const result = await fetch('https://api.github.com/repos/' + repository +
    '/statuses/' + commit, {
    method: 'POST', headers: {
      Authorization: 'Bearer ' + githubToken,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      context, state, description: description.slice(0, 140),
      target_url: 'https://github.com/' + repository + '/actions/runs/' +
        process.env.GITHUB_RUN_ID,
    }),
    signal: AbortSignal.timeout(12000),
  })
  assert.equal(result.status, 201, 'GitHub status publication')
}
async function markerState(expected, label) {
  const deadline = Date.now() + 12 * 60 * 1000
  while (Date.now() < deadline) {
    try {
      const response = await api('/api/health')
      const present = response.status === 200 &&
        Array.isArray(response.data.capabilities) &&
        response.data.capabilities.includes(marker)
      if (response.status === 200 && present === expected) {
        console.log('P4b Maker ' + label + ': PASS')
        return
      }
    } catch (error) {
      console.log('Maker health not yet consistent: ' + error.name)
    }
    await sleep(10000)
  }
  throw new Error('Maker ' + label + ' not observed before timeout')
}
function v4(accountId) {
  const database = {
    formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6,
      tables: tables.map(name => ({ name, schema: '++id' })),
      data: tables.map(name => ({
        tableName: name, inbound: true,
        rows: name === 'wordRecords' ?
          [{ id: 1, word: 'p4b-rollback-witness' }] : [],
      })),
    },
  }
  const workspaceData = {
    database, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
  }
  const payload = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId },
      createdAt: new Date().toISOString() },
    workspaceData,
  }
  const canonical = {
    database: { tables: database.data.tables, data: database.data.data },
    learnRuntime: workspaceData.learnRuntime,
    settings: workspaceData.settings,
    navigation: workspaceData.navigation,
  }
  const zipped = gzipSync(Buffer.from(JSON.stringify(payload)))
  return {
    payloadBase64: zipped.toString('base64'),
    logicalFingerprint: sha(Buffer.from(stable(canonical))),
    payloadSha256: sha(zipped),
  }
}
async function run() {
  await markerState(true, 'temporary V4 seed version deployed')
  const registered = await api('/api/auth/register', 'POST', {
    username, password, deviceId: 'p4b-rollback-witness',
  }, '')
  if (registered.status === 409) {
    throw new Error('test13 exists: refusing to touch a pre-existing account')
  }
  if (registered.status === 201 && registered.data?.token) {
    token = registered.data.token
    created = true
  }
  assert.equal(registered.status, 201, 'new isolated test13 registration')
  const userId = registered.data?.user?.userId
  assert.ok(userId && token)
  const before = await api('/api/sync/v2/meta')
  assert.equal(before.status, 200)
  assert.equal(before.data.revision, 0)

  const payload = v4(userId)
  const push = await api('/api/sync/v2', 'PUT', {
    baseRevision: 0, clientFormatVersion: 'qwerty-backup-v4',
    deviceId: 'p4b-rollback-seed',
    payloadBase64: payload.payloadBase64,
    logicalFingerprint: payload.logicalFingerprint,
  })
  assert.equal(push.status, 200, 'V4 seed upload HTTP status')
  assert.equal(push.data.revision, 1)
  assert.equal(push.data.logicalFingerprint, payload.logicalFingerprint)
  assert.equal(push.data.payloadSha256, payload.payloadSha256)
  console.log('P4b disposable V4 Blob witness seeded: PASS')
  await status('p4b/rollback-seeded', 'success',
    'V4 immutable witness seeded in temporary Maker; restore strict master now')

  // This job holds the token/password privately while its deploy operator
  // moves master back to the stable V4-aware strict-allowlist release.
  await markerState(false, 'strict rollback version deployed')

  const meta = await api('/api/sync/v2/meta')
  assert.equal(meta.status, 200)
  assert.equal(meta.data.revision, 1)
  assert.equal(meta.data.clientFormatVersion, 'qwerty-backup-v4')
  assert.equal(meta.data.logicalFingerprint, payload.logicalFingerprint)
  assert.equal(meta.data.payloadSha256, payload.payloadSha256)

  const downloaded = await api('/api/sync/v2')
  assert.equal(downloaded.status, 200)
  const received = Buffer.from(downloaded.data.payloadBase64, 'base64')
  assert.equal(sha(received), payload.payloadSha256)
  const unpacked = JSON.parse(gunzipSync(received).toString('utf8'))
  assert.equal(unpacked.metadata.source.accountId, userId)
  assert.equal(unpacked.workspaceData.database.data.data
    .find(table => table.tableName === 'wordRecords').rows[0].word,
  'p4b-rollback-witness')
  console.log('P4b actual Maker rollback preserved V4 Blob revision/bytes: PASS')

  const v1 = await api('/api/sync', 'PUT', {
    baseRevision: 1,
    clientFormatVersion: 'qwerty-backup-v3',
    payloadBase64: gzipSync(Buffer.from('{}')).toString('base64'),
  })
  assert.equal(v1.status, 409)
  assert.equal(v1.data.error, 'sync_upgrade_required')
  const blockedV4 = await api('/api/sync/v2', 'PUT', {
    baseRevision: 1,
    clientFormatVersion: 'qwerty-backup-v4',
    payloadBase64: payload.payloadBase64,
    logicalFingerprint: payload.logicalFingerprint,
  })
  assert.equal(blockedV4.status, 403)
  assert.equal(blockedV4.data.error, 's2_write_not_enabled')
  assert.equal((await api('/api/sync/v2/meta')).data.revision, 1)
  console.log('P4b rollback preserves old V1 write guard and strict V2 deny: PASS')
}
try {
  await run()
} catch (error) {
  failure = error
  console.error('P4b data-preserving rollback validation failed:', error.message)
} finally {
  if (created && token) {
    try {
      const cleaned = await api('/api/auth/account', 'DELETE', {
        currentPassword: password,
      })
      assert.equal(cleaned.status, 200)
      assert.equal(cleaned.data?.deleted?.accountDeleted, true)
      console.log('P4b rollback test13 account cleanup: PASS')
    } catch (error) {
      failure ||= error
      console.error('P4b rollback cleanup FAILED:', error.message)
    }
  }
  await status('p4b/rollback-complete',
    failure ? 'failure' : 'success',
    failure ? 'P4b Maker data rollback/cleanup not fully validated' :
      'Maker rollback V4 bytes, V1/2 guards and cleanup PASS')
}
if (failure) throw failure
