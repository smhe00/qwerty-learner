/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { createSessionHandoffBarrier } from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { AtomicTestStore, deferred } from './session-handoff-test-store.mjs'

// Exact production service + exact Blob adapter; only provider I/O is fake.
// Intentionally IGNORE onlyIfNew: this suite must not invent atomic Blob CAS.
class PausableBlob {
  data = new Map()
  pause = null
  armManifestPause() {
    const reached = deferred(), release = deferred()
    this.pause = { reached, release }
    return this.pause
  }
  async setJSON(key, value) {
    if (this.pause && /\/revisions\/\d+\.json$/.test(key)) {
      const pause = this.pause
      this.pause = null
      pause.reached.resolve()
      await pause.release.promise
    }
    this.data.set(key, structuredClone(value))
  }
  async set(key, value) { this.data.set(key, Buffer.from(value)) }
  async get(key, { type } = {}) {
    const value = this.data.get(key)
    if (value === undefined) return null
    if (type === 'arrayBuffer') {
      const bytes = Buffer.from(value)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
    return structuredClone(value)
  }
  async list({ prefix }) {
    return { blobs: [...this.data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
  }
  async delete(key) { this.data.delete(key) }
}

const tables = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
const stable = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
const sha = value => crypto.createHash('sha256').update(value).digest('hex')

function fixture(accountId, word, baseRevision = 0) {
  const database = { data: {
    tables: tables.map(name => ({ name })),
    data: tables.map(tableName => ({ tableName,
      rows: tableName === 'wordRecords' ? [{ word, dict: 'handoff-fixture', timeStamp: 1 }] : [] })),
  } }
  const data = { database, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'handoff-fixture', currentChapter: 0 } }
  const canonical = { ...data, database: {
    tables: [...database.data.tables].sort((a, b) => stable(a.name).localeCompare(stable(b.name))),
    data: [...database.data.data].sort((a, b) => stable(a.tableName).localeCompare(stable(b.tableName))),
  } }
  const payloadBytes = gzipSync(Buffer.from(JSON.stringify({
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-25T00:00:00Z', source: { kind: 'account', accountId } },
    workspaceData: data,
  })))
  return { baseRevision, clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: sha(stable(canonical)), payloadBytes, deviceId: word }
}

async function setup() {
  const blob = new PausableBlob()
  const storage = createEdgeOneBlobStorage(blob)
  const a = createBackendService({ storage })
  // Two independent backend objects, as in two serverless invocations.
  const b = createBackendService({ storage })
  const username = `handoff-${crypto.randomBytes(6).toString('hex')}`
  const password = 'synthetic-test-only'
  const first = await a.register(username, password, 'device-A')
  return { blob, a, b, username, password, first, accountHash: sha(username) }
}

test('BASELINE COUNTEREXAMPLE: existing login succeeds before A finishes its V4 manifest',
  { timeout: 10_000 }, async () => {
    const { blob, a, b, username, password, first } = await setup()
    const pause = blob.armManifestPause()
    const payload = fixture(first.user.userId, 'alpha')
    const writing = a.putSyncV4Binary(first.token, payload)
    await pause.reached.promise
    const second = await b.login(username, password, 'device-B')
    assert.equal((await b.syncMeta(second.token)).revision, 0)
    await assert.rejects(a.me(first.token), error => error.code === 'session_revoked')
    pause.release.resolve()
    // The ALREADY ADMITTED old request still succeeds after the new login.
    assert.equal((await writing).revision, 1)
    assert.equal((await b.syncMeta(second.token)).dataSha256, sha(payload.payloadBytes))
  })

test('BASELINE COUNTEREXAMPLE: ignored onlyIfNew allows late A to overwrite B revision',
  { timeout: 10_000 }, async () => {
    const { blob, a, b, username, password, first } = await setup()
    const pause = blob.armManifestPause()
    const oldPayload = fixture(first.user.userId, 'alpha')
    const writing = a.putSyncV4Binary(first.token, oldPayload)
    await pause.reached.promise
    const second = await b.login(username, password, 'device-B')
    const newPayload = fixture(first.user.userId, 'beta')
    assert.equal((await b.putSyncV4Binary(second.token, newPayload)).revision, 1)
    assert.equal((await b.syncMeta(second.token)).dataSha256, sha(newPayload.payloadBytes))
    pause.release.resolve()
    await writing
    assert.equal((await b.syncMeta(second.token)).dataSha256, sha(oldPayload.payloadBytes))
  })

test('barrier integration: B waits for A publication; subsequent B upload uses revision 2',
  { timeout: 10_000 }, async () => {
    const { blob, a, b, username, password, first, accountHash } = await setup()
    const store = new AtomicTestStore()
    const gateA = createSessionHandoffBarrier({ store, namespace: 'integration', pollMs: 1 })
    const gateB = createSessionHandoffBarrier({ store, namespace: 'integration', pollMs: 1 })
    const pause = blob.armManifestPause()
    const payload = fixture(first.user.userId, 'alpha')
    const writing = gateA.execute(accountHash, 'writer', () => a.putSyncV4Binary(first.token, payload))
    await pause.reached.promise
    let loginReturned = false
    const login = gateB.execute(accountHash, 'handoff', () => b.login(username, password, 'device-B'))
      .then(value => { loginReturned = true; return value })
    await store.when(state => Boolean(state.pending))
    assert.equal(loginReturned, false)
    await assert.rejects(gateA.execute(accountHash, 'writer', () => assert.fail('new A write')),
      error => error.code === 'handoff_draining')
    pause.release.resolve()
    const [published, second] = await Promise.all([writing, login])
    assert.equal(published.revision, 1)
    assert.equal(loginReturned, true)
    await assert.rejects(a.me(first.token), error => error.code === 'session_revoked')
    const current = await b.syncMeta(second.token)
    assert.equal(current.revision, 1)
    assert.equal(current.dataSha256, sha(payload.payloadBytes))
    const next = fixture(first.user.userId, 'beta-after-alpha', current.revision)
    assert.equal((await gateB.execute(accountHash, 'writer',
      () => b.putSyncV4Binary(second.token, next))).revision, 2)
    assert.equal((await b.syncMeta(second.token)).dataSha256, sha(next.payloadBytes))
  })
