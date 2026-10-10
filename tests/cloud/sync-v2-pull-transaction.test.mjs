/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-s2-pull-machine-'))
const out = join(tmp, 'machine.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v2-pull-transaction.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { executeSyncV2Pull, recoverSyncV2Pull } = await import(pathToFileURL(out).href)

const accountId = 'immutable-account-A'
const fingerprint = 'b'.repeat(64)
const input = {
  version: 1, accountId, registryGeneration: 4, revision: 7,
  fingerprint, oldBaseline: { accountId, baseRevision: 5, logicalFingerprint: 'a'.repeat(64) },
  snapshot: {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-10T00:00:00Z',
      source: { kind: 'account', accountId } },
    workspaceData: { navigation: { currentDict: 'dict', currentChapter: 5 } },
  },
}

function fixture(fail) {
  const state = { pending: null, data: 'LOCAL-before', baseline: input.oldBaseline,
    sealed: false, restored: 0, steps: [] }
  const port = {
    async read() { return structuredClone(state.pending) },
    async stage(record) {
      if (state.pending) throw Error('pending already exists')
      state.pending = structuredClone(record)
      state.steps.push('stage')
      if (fail.step === 'stage-after-durable') {
        fail.step = ''
        throw Error('crash after durable staging')
      }
    },
    async finalize(record) {
      assert.equal(state.pending.revision, record.revision)
      assert.equal(state.baseline.baseRevision, record.oldBaseline.baseRevision)
      if (fail.step === 'finish-before-commit') {
        fail.step = ''
        throw Error('crash before final atomic commit')
      }
      state.baseline = { accountId, baseRevision: record.revision,
        logicalFingerprint: record.fingerprint }
      state.pending = null
      state.steps.push('finalize')
      if (fail.step === 'finish-after-commit') {
        fail.step = ''
        throw Error('lost response after committed baseline/journal')
      }
    },
  }
  const replica = {
    async restore(snapshot, owner) {
      assert.equal(owner, accountId)
      assert.equal(snapshot.metadata.source.accountId, accountId)
      state.restored++
      state.data = 'PARTIAL'
      if (fail.step === 'restore') {
        fail.step = ''
        throw Error('crash during RecordDB restore')
      }
      state.data = 'CLOUD-revision-' + input.revision
      state.steps.push('restore')
    },
    async seal() {
      if (fail.step === 'seal') {
        fail.step = ''
        throw Error('crash before localStorage witness reseal')
      }
      state.sealed = true
      state.steps.push('seal')
    },
  }
  return { state, port, replica }
}

test('S2 Pull stage precedes restore, seal precedes baseline CAS and journal deletion', async () => {
  const f = fixture({ step: '' })
  const events = []
  await executeSyncV2Pull(f.port, f.replica, input, x => events.push(x))
  assert.deepEqual(events, ['staging','restoring','sealing','committing','complete'])
  assert.deepEqual(f.state.steps, ['stage','restore','seal','finalize'])
  assert.equal(f.state.data, 'CLOUD-revision-7')
  assert.equal(f.state.pending, null)
  assert.equal(f.state.baseline.baseRevision, 7)
  assert.equal(await recoverSyncV2Pull(f.port, f.replica), false)
})

test('crash after journal or during restore/seal/finalize replays exact target', async () => {
  for (const point of ['stage-after-durable','restore','seal','finish-before-commit']) {
    const fail = { step: point }
    const f = fixture(fail)
    await assert.rejects(executeSyncV2Pull(f.port, f.replica, input))
    assert.ok(f.state.pending, point)
    assert.equal(f.state.baseline.baseRevision, 5, point)
    assert.equal(await recoverSyncV2Pull(f.port, f.replica), true)
    assert.equal(f.state.pending, null, point)
    assert.equal(f.state.data, 'CLOUD-revision-7', point)
    assert.equal(f.state.baseline.baseRevision, 7, point)
    assert.equal(f.state.sealed, true, point)
  }
})

test('error after atomic finish cannot undo a completed durable baseline', async () => {
  const f = fixture({ step: 'finish-after-commit' })
  await assert.rejects(executeSyncV2Pull(f.port, f.replica, input), /recover before/)
  assert.equal(f.state.pending, null)
  assert.equal(f.state.baseline.baseRevision, 7)
  assert.equal(await recoverSyncV2Pull(f.port, f.replica), false)
})

test('an unfinished Pull prevents another Pull from being staged', async () => {
  const f = fixture({ step: 'restore' })
  await assert.rejects(executeSyncV2Pull(f.port, f.replica, input))
  await assert.rejects(executeSyncV2Pull(f.port, f.replica, input), /requires recovery/)
  assert.equal(f.state.baseline.baseRevision, 5)
})
