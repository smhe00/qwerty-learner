/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-s2-manual-'))
const execFile = join(tmp, 'executor.mjs')
const v4File = join(tmp, 'v4.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/v2-manual-executor.ts')],
    outfile: execFile, bundle: true, platform: 'node', target: 'node20', format: 'esm' }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: v4File, bundle: true, platform: 'node', target: 'node20', format: 'esm' }),
])
after(() => rmSync(tmp, { recursive: true, force: true }))
const { executeManualSyncV2 } = await import(pathToFileURL(execFile).href)
const { workspaceFingerprintV4 } = await import(pathToFileURL(v4File).href)

const id = 's2-owner'
const TABLES = ['achievementEvents','achievementStates','chapterRecords',
  'reviewRecords','reviewWordStates','wordRecords']
function snap(chapter = 0) {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId: id }, createdAt: 'today' },
    workspaceData: {
      database: { formatName: 'dexie', data: {
        tables: TABLES.map(name => ({ name, schema: '++id' })), data: [],
      } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'zhongkaohexin', currentChapter: chapter },
    },
  }
}
const absent = () => ({
  hasData: false, revision: 0, updatedAt: null, sizeBytes: 0,
  dataSha256: null, payloadSha256: null, logicalFingerprint: null,
  clientFormatVersion: null, deviceId: null,
})
async function cloud(s, revision = 1) {
  const bytes = gzipSync(JSON.stringify(s))
  const hash = await workspaceFingerprintV4(s)
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  const meta = {
    ...absent(), hasData: true, revision, sizeBytes: bytes.length,
    clientFormatVersion: 'qwerty-backup-v4', logicalFingerprint: hash,
    payloadSha256: digest, dataSha256: digest,
  }
  return { meta, snapshot: { ...meta,
    payloadEncoding: 'base64', payloadBase64: bytes.toString('base64') } }
}
function fixture(local, meta, baseline = null) {
  const state = {
    baseline, pending: null, restored: null,
    calls: [], metaCalls: 0, cloud: null, cloudMetaAfter: null, uploaded: null,
  }
  const port = {
    accountId: id, registryGeneration: 3,
    async assertQuiescentOwner() { state.calls.push('guard') },
    async flush() { state.calls.push('flush') },
    async capture() { state.calls.push('capture'); return structuredClone(local) },
    async readBaseline() { return structuredClone(state.baseline) },
    async compareAndSwapBaseline(expected, next) {
      assert.deepEqual(state.baseline, expected)
      state.calls.push('baseline')
      state.baseline = structuredClone(next)
    },
    async getMeta() {
      state.metaCalls++
      state.calls.push('meta')
      return structuredClone(state.metaCalls > 1 && state.cloudMetaAfter ?
        state.cloudMetaAfter : meta)
    },
    async getSnapshot() { state.calls.push('download'); return structuredClone(state.cloud) },
    async put(input) {
      state.calls.push('upload')
      state.uploaded = input
      const bytes = Buffer.from(input.payloadBase64, 'base64')
      return { ...absent(), hasData: true, revision: input.baseRevision + 1,
        logicalFingerprint: input.logicalFingerprint,
        clientFormatVersion: 'qwerty-backup-v4',
        sizeBytes: bytes.length, payloadSha256: crypto.createHash('sha256')
          .update(bytes).digest('hex') }
    },
    async saveSource(snapshot) {
      state.calls.push('save-source')
      assert.deepEqual(snapshot, local)
    },
    journal: {
      async read() { return structuredClone(state.pending) },
      async stage(pending) { state.calls.push('stage'); state.pending = structuredClone(pending) },
      async finalize(pending) {
        state.calls.push('finalize')
        assert.equal(state.pending.fingerprint, pending.fingerprint)
        state.baseline = { accountId: id, baseRevision: pending.revision,
          logicalFingerprint: pending.fingerprint }
        state.pending = null
      },
    },
    replica: {
      async restore(snapshot, account) {
        assert.equal(account, id)
        state.calls.push('restore')
        state.restored = structuredClone(snapshot)
      },
      async seal() { state.calls.push('seal') },
    },
  }
  return { port, state }
}
test('S2 canonical equality uses metadata-only noop without gzip/cloud payload', async () => {
  const local = snap()
  const c = await cloud(local, 5)
  const f = fixture(local, c.meta)
  const result = await executeManualSyncV2(f.port)
  assert.deepEqual(result, { status: 'noop', revision: 5 })
  assert.equal(f.state.baseline.baseRevision, 5)
  assert.equal(f.state.calls.includes('upload'), false)
  assert.equal(f.state.calls.includes('download'), false)
  assert.equal(f.state.calls.includes('stage'), false)
})

test('S2 local-only change uses exact CAS and server transport digest proof', async () => {
  const f = fixture(snap(3), absent())
  const result = await executeManualSyncV2(f.port)
  assert.deepEqual(result, { status: 'pushed', revision: 1 })
  assert.equal(f.state.uploaded.baseRevision, 0)
  assert.equal(f.state.uploaded.clientFormatVersion, 'qwerty-backup-v4')
  assert.equal(f.state.baseline.baseRevision, 1)
  assert.equal(f.state.calls.includes('stage'), false)
})

test('S2 divergence and V3 cloud both fail closed without payload transfer', async () => {
  const f = fixture(snap(3), (await cloud(snap(5), 3)).meta, {
    accountId: id, baseRevision: 2, logicalFingerprint: await workspaceFingerprintV4(snap(1)),
  })
  const divergent = await executeManualSyncV2(f.port)
  assert.deepEqual(divergent, { status: 'conflict', reason: 'concurrent-edits' })
  assert.equal(f.state.calls.includes('upload'), false)
  assert.equal(f.state.calls.includes('download'), false)
  const old = fixture(snap(), {
    ...absent(), hasData: true, revision: 1, clientFormatVersion: 'qwerty-backup-v3',
  })
  const blocked = await executeManualSyncV2(old.port)
  assert.equal(blocked.status, 'blocked')
  assert.equal(old.state.calls.includes('stage'), false)
})

test('S2 pulls only after verified bytes, rechecked meta and saved local source', async () => {
  const f = fixture(snap(), (await cloud(snap(9))).meta)
  f.state.cloud = (await cloud(snap(9))).snapshot
  const result = await executeManualSyncV2(f.port)
  assert.deepEqual(result, { status: 'pull-reload-required', revision: 1 })
  assert.equal(f.state.baseline, null, 'baseline only advances after next boot recovery')
  assert.equal(f.state.restored, null, 'never restore in mounted/current JS realm')
  assert.equal(f.state.pending.revision, 1)
  const before = f.state.calls.filter(x =>
    ['download','save-source','stage','restore','seal','finalize'].includes(x))
  assert.deepEqual(before, ['download','save-source','stage'])
  // Model the next guarded boot's idempotent journal replay.
  const pending = await f.port.journal.read()
  await f.port.replica.restore(pending.snapshot, pending.accountId)
  await f.port.replica.seal()
  await f.port.journal.finalize(pending)
  assert.equal(f.state.baseline.baseRevision, 1)
  assert.equal(f.state.restored.workspaceData.navigation.currentChapter, 9)
})

test('S2 cloud revision advancing during Pull refuses restore before journaling', async () => {
  const first = await cloud(snap(9), 1)
  const f = fixture(snap(), first.meta)
  f.state.cloud = first.snapshot
  f.state.cloudMetaAfter = { ...first.meta, revision: 2 }
  await assert.rejects(executeManualSyncV2(f.port), /remote revision changed/)
  assert.equal(f.state.pending, null)
  assert.equal(f.state.baseline, null)
  assert.equal(f.state.calls.includes('restore'), false)
})
