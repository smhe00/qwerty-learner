import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m4-merge-'))
const mod = join(dir, 'm4.mjs')
const workspace = join(dir, 'v4.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/m4-merge-transaction.ts')],
    outfile: mod, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: workspace, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { recursive: true, force: true }))
const { executeM4Merge: execute, recoverM4Merge: recover,
  validatePendingM4Merge: validate,
  classifyM4ReadbackDifference: classify,
  classifyM4WordRecordDifference: classifyWords } =
  await import(pathToFileURL(mod).href)
const { workspaceFingerprintV4: fingerprint } = await import(pathToFileURL(workspace).href)

const accountId = 'immutable-A'
const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
function snapshot(word, account = accountId) {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-22T00:00:00Z',
      source: { kind: 'account', accountId: account } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1, data: {
        databaseName: 'RecordDB', databaseVersion: 6,
        tables: names.map(name => ({ name, schema: '++id' })),
        data: names.map(tableName => ({
          tableName, inbound: true,
          rows: tableName === 'wordRecords' ? [{ id: 1, word }] :
            tableName === 'reviewRecords' ? [{ id: 1, isFinished: false, index: 0 }] : [],
        })),
      } },
      learnRuntime: { dailySessions: { school: {
        version: 1, dict: 'school', sessionId: 'school:day',
        dateKey: '2026-10-22', startedAt: 20, status: 'active',
        dailyNewTarget: 20, plannedNewWords: 5, blockCount: 1,
        plannedReviewWords: [], carryOverAcquisitionWords: [],
        completedBlockIds: [],
      } } },
      settings: { version: 1, values: { pronunciation: 'en' } },
      navigation: { currentDict: 'school', currentChapter: 1 },
    },
  }
}
const original = snapshot('before')
const candidate = snapshot('after')
function fixture(fail = {}) {
  const state = { pending: null, working: structuredClone(original),
    staged: 0, restored: 0, sealed: 0, finalized: [], snapshots: [],
    steps: [] }
  const journal = {
    async read() { return structuredClone(state.pending) },
    async stage(pending) {
      if (state.pending) throw Error('stage collision')
      state.pending = structuredClone(pending)
      state.staged++
      state.steps.push('stage')
      if (fail.stage) { fail.stage = false; throw Error('crash after stage') }
    },
    async finalize(pending, decision) {
      assert.equal(state.pending.candidateFingerprint, pending.candidateFingerprint)
      assert.equal(state.pending.originalFingerprint, pending.originalFingerprint)
      if (fail.finalize) { fail.finalize = false; throw Error('crash before commit') }
      state.finalized.push(decision)
      state.snapshots.push(structuredClone(state.pending.original))
      state.pending = null
      state.steps.push('finalize')
    },
  }
  const replica = {
    async capture(account) {
      assert.equal(account, accountId)
      if (fail.captureWrong) return structuredClone(snapshot('corrupt'))
      return structuredClone(state.working)
    },
    async restore(target, account) {
      assert.equal(account, accountId)
      state.restored++
      state.working.workspaceData.database.data.data[0].rows = []
      state.steps.push('restore')
      if (fail.restore) { fail.restore = false; throw Error('crash mid restore') }
      state.working = structuredClone(target)
      if (fail.corrupt) {
        fail.corrupt = false
        state.working.workspaceData.navigation.currentChapter = 99
      }
    },
    async seal() {
      if (fail.seal) { fail.seal = false; throw Error('seal interrupted') }
      state.sealed++
      state.steps.push('seal')
    },
  }
  return { state, journal, replica }
}
async function run(f, target = candidate, fp = fingerprint(original), observer) {
  await execute(f.journal, f.replica, {
    accountId, registryGeneration: 3,
    candidate: target,
    expectedOriginalFingerprint: await fp,
  }, observer)
}

test('stage rollback and complete candidate before restore; readback, seal, finalize ordered', async () => {
  const f = fixture()
  const phases = []
  await run(f, candidate, fingerprint(original), phase => phases.push(phase))
  assert.deepEqual(phases, ['capture', 'stage', 'restore', 'verify', 'seal',
    'finalize', 'complete'])
  assert.deepEqual(f.state.steps, ['stage','restore','seal','finalize'])
  assert.equal(await fingerprint(f.state.working), await fingerprint(candidate))
  assert.equal(await fingerprint(f.state.snapshots[0]), await fingerprint(original))
  assert.deepEqual(f.state.finalized, ['apply'])
  assert.equal(await recover(f.journal, f.replica, 'apply'), false)
})

test('pre-stage stale source and foreign-account candidate do not write', async () => {
  const a = fixture()
  await assert.rejects(run(a, candidate, fingerprint(snapshot('stale'))),
    /m4-stale-local-source-no-write/)
  assert.equal(a.state.staged, 0)
  assert.equal(a.state.restored, 0)
  await assert.rejects(run(a, snapshot('foreign', 'account-B'),
    fingerprint(original)), /m4-account-owner-mismatch/)
  assert.equal(a.state.staged, 0)
  assert.equal(a.state.restored, 0)
})

test('missing six-table manifest fails before any destructive operation', async () => {
  const f = fixture()
  const broken = structuredClone(candidate)
  broken.workspaceData.database.data.tables.pop()
  await assert.rejects(run(f, broken, fingerprint(original)), /missing or duplicate durable tables/)
  assert.equal(f.state.staged, 0)
})

test('crash after stage, during restore, bad readback, seal or finalize leaves durable journal', async () => {
  for (const key of ['stage','restore','corrupt','seal','finalize']) {
    const fail = { [key]: true }
    const f = fixture(fail)
    await assert.rejects(run(f), /m4-merge-interrupted|crash after stage/)
    assert.ok(f.state.pending, key)
    assert.equal(f.state.finalized.length, 0, key)
    assert.equal(await recover(f.journal, f.replica, 'apply'), true, key)
    assert.equal(await fingerprint(f.state.working), await fingerprint(candidate), key)
    assert.deepEqual(f.state.finalized, ['apply'])
  }
})

test('explicit rollback restores all six tables, DailySession, settings, navigation', async () => {
  const f = fixture({ restore: true })
  await assert.rejects(run(f))
  assert.ok(f.state.pending)
  await assert.rejects(run(f), /m4-previous-merge-must-recover-first/)
  assert.equal(await recover(f.journal, f.replica, 'rollback'), true)
  assert.equal(await fingerprint(f.state.working), await fingerprint(original))
  assert.equal(f.state.working.workspaceData.learnRuntime.dailySessions.school.sessionId,
    original.workspaceData.learnRuntime.dailySessions.school.sessionId)
  assert.deepEqual(f.state.finalized, ['rollback'])
})

test('readback mismatch blocks seal, and corrupt pending payload cannot finalize', async () => {
  const f = fixture({ corrupt: true })
  await assert.rejects(run(f), /m4-merge-interrupted/)
  assert.ok(f.state.pending)
  assert.equal(f.state.sealed, 0)
  f.state.pending.original.workspaceData.settings.values.pronunciation = 'corrupted'
  await assert.rejects(recover(f.journal, f.replica, 'rollback'),
    /m4-journal-fingerprint-mismatch/)
  assert.equal(f.state.finalized.length, 0)
  assert.ok(f.state.pending)
})

test('observer failure cannot interrupt committed recovery, invalid rollback decision fails', async () => {
  const f = fixture()
  await run(f, candidate, fingerprint(original), () => { throw Error('UI') })
  assert.deepEqual(f.state.finalized, ['apply'])
  await assert.rejects(recover(f.journal, f.replica, 'not-a-decision'),
    /m4-invalid-recovery-decision/)
})

test('journal preflight validates generation and source/candidate integrity', async () => {
  const f = fixture({ stage: true })
  await assert.rejects(run(f), /crash after stage/)
  const pending = structuredClone(f.state.pending)
  await validate(pending)
  pending.registryGeneration = 0
  await assert.rejects(validate(pending), /m4-invalid-transaction-identity/)
  pending.registryGeneration = 3
  pending.candidate.workspaceData.navigation.currentChapter = 101
  await assert.rejects(validate(pending), /m4-journal-fingerprint-mismatch/)
})


test('readback mismatch identifies only safe V4 component and never leaks row contents', async () => {
  const cases = [
    ['learnruntime', s => { s.workspaceData.learnRuntime.dailySessions.school.blockCount++ }],
    ['settings', s => { s.workspaceData.settings.values.pronunciation = 'other' }],
    ['navigation', s => { s.workspaceData.navigation.currentChapter++ }],
    ['table-wordrecords', s => {
      s.workspaceData.database.data.data
        .find(t => t.tableName === 'wordRecords').rows[0].word = 'secret-value'
    }],
    ['table-reviewrecords', s => {
      s.workspaceData.database.data.data
        .find(t => t.tableName === 'reviewRecords').rows[0].index++
    }],
    ['tablemanifest', s => {
      s.workspaceData.database.data.tables[0].schema += ',secret-index'
    }],
  ]
  for (const [code, mutate] of cases) {
    const readback = structuredClone(candidate)
    mutate(readback)
    const category = classify(candidate, readback)
    assert.equal(category, code)
    assert.doesNotMatch(category, /secret|immutable-a|school:day/)
  }
})

test('a failed V4 verify retains recovery journal and reports component only', async () => {
  const f = fixture()
  f.replica.capture = async () => {
    const snapshot = structuredClone(f.state.working)
    if (f.state.staged) {
      snapshot.workspaceData.database.data.data
        .find(t => t.tableName === 'reviewRecords').rows[0].index += 1
    }
    return snapshot
  }
  await assert.rejects(run(f), /m4-merge-interrupted-recovery-required/)
  assert.equal(f.state.finalized.length, 0)
  assert.ok(f.state.pending)
})


test('wordRecords readback diagnostics are bounded schema codes, never word text', () => {
  const cases = [
    ['row-count', snapshot => { snapshot.workspaceData.database.data.data.find(
      g => g.tableName === 'wordRecords').rows.pop() }],
    ['field-word', snapshot => { snapshot.workspaceData.database.data.data.find(
      g => g.tableName === 'wordRecords').rows[0].word = 'private-word' }],
    ['typeson-only', snapshot => { snapshot.workspaceData.database.data.data.find(
      g => g.tableName === 'wordRecords').rows[0].$types = { '': 'userObject' } }],
  ]
  for (const [expected, edit] of cases) {
    const actual = structuredClone(candidate)
    edit(actual)
    const result = classifyWords(candidate, actual)
    assert.equal(result, expected)
    assert.doesNotMatch(result, /private-word|sessionId|account/)
  }
  assert.equal(classifyWords(candidate, structuredClone(candidate)),
    'row-order-or-group-metadata')
})
