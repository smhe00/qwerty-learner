import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'qwerty-v4-conservative-'))
const bundle = join(temp, 'merge.mjs')
const w = join(temp, 'workspace.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/v4-conservative-three-way.ts')],
    outfile: bundle, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: w, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(temp, { recursive: true, force: true }))
const { previewConservativeThreeWayV4: preview } =
  await import(pathToFileURL(bundle).href)
const { workspaceFingerprintV4: fingerprint } =
  await import(pathToFileURL(w).href)
const accountId = 'm2-merge-account'
const tables = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
function snap() {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-22T00:00:00Z',
      source: { kind: 'account', accountId } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1,
        data: { databaseName: 'RecordDB', databaseVersion: 6,
          tables: tables.map(name => ({ name, schema: '++id' })),
          data: tables.map(tableName => ({
            tableName, inbound: true, rows: tableName === 'wordRecords'
              ? [{ id: 1, word: 'alpha', dict: 'school' }] : [],
          })) } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'school', currentChapter: 0 },
    },
  }
}
function addWord(snapshot, word = 'beta') {
  snapshot.workspaceData.database.data.data
    .find(x => x.tableName === 'wordRecords').rows
    .push({ id: 2, word, dict: 'school' })
}
async function inspect(ancestor, local, remote, hash = null) {
  return preview({ accountId, pinnedAncestorFingerprint: hash ??
    await fingerprint(ancestor), ancestor, local, remote })
}
test('full learning record changes + independent settings merge into a complete V4 candidate', async () => {
  const ancestor = snap()
  const local = structuredClone(ancestor)
  const remote = structuredClone(ancestor)
  addWord(local)
  remote.workspaceData.settings.values.pronunciation = 'en'
  const preserved = structuredClone({ ancestor, local, remote })
  const r = await inspect(ancestor, local, remote)
  assert.equal(r.status, 'projected', r.reason)
  assert.equal(r.publishReady, false)
  assert.equal(r.convergenceComplete, false)
  assert.equal(r.needsAuthenticatedPublication, true)
  assert.equal(r.tableSource, 'local')
  assert.equal(r.settingsSources.pronunciation, 'remote')
  assert.equal(r.candidate.workspaceData.database.data.data
    .find(x => x.tableName === 'wordRecords').rows.length, 2)
  assert.equal(r.candidate.workspaceData.settings.values.pronunciation, 'en')
  assert.equal(r.candidate.workspaceData.database.data.data.length, 6)
  assert.equal(r.candidateFingerprint, await fingerprint(r.candidate))
  r.candidate.workspaceData.navigation.currentChapter = 32
  assert.deepEqual({ ancestor, local, remote }, preserved)
})
test('independent setting keys and navigation are three-way merged without dropping keys', async () => {
  const base = snap(), left = snap(), right = snap()
  left.workspaceData.settings.values.pronunciation = 'uk'
  right.workspaceData.settings.values.isOpenDarkModeAtom = true
  right.workspaceData.navigation.currentChapter = 2
  const r = await inspect(base, left, right)
  assert.equal(r.status, 'projected', r.reason)
  assert.equal(r.navigationSource, 'remote')
  assert.deepEqual(r.candidate.workspaceData.settings.values,
    { isOpenDarkModeAtom: true, pronunciation: 'uk' })
})
test('both devices changing learning tables differently always block; no FSRS guessing', async () => {
  const a = snap(), l = snap(), r = snap()
  addWord(l, 'left')
  addWord(r, 'right')
  const result = await inspect(a, l, r)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason,
    'both-devices-changed-learning-unit-requires-fsrs-replay')
  assert.equal(result.candidate, undefined)
})
test('a concurrent daily session change cannot be mixed with the other device learning rows', async () => {
  const a = snap(), l = snap(), r = snap()
  addWord(l)
  r.workspaceData.learnRuntime.dailySessions.school = {
    version: 1, dict: 'school', sessionId: 'session-A', dateKey: '2026-10-22',
    startedAt: 1800000000, status: 'active', dailyNewTarget: 20,
    plannedNewWords: 20, blockCount: 1,
    plannedReviewWords: [], carryOverAcquisitionWords: [],
    completedBlockIds: [],
  }
  const result = await inspect(a, l, r)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason,
    'both-devices-changed-learning-unit-requires-fsrs-replay')
})
test('same setting edited divergently fails without last-writer-wins', async () => {
  const a = snap(), l = snap(), r = snap()
  l.workspaceData.settings.values.pronunciation = 'en'
  r.workspaceData.settings.values.pronunciation = 'us'
  const result = await inspect(a, l, r)
  assert.equal(result.reason, 'divergent-setting:pronunciation')
})
test('different navigation changes are not silently selected', async () => {
  const a = snap(), l = snap(), r = snap()
  l.workspaceData.navigation.currentChapter = 3
  r.workspaceData.navigation.currentChapter = 4
  assert.equal((await inspect(a, l, r)).reason, 'both-devices-changed-navigation')
})
test('identical independent learning changes yield a single unchanged V4 record set', async () => {
  const a = snap(), l = snap(), r = snap()
  addWord(l)
  addWord(r)
  const result = await inspect(a, l, r)
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.tableSource, 'identical')
  assert.equal(result.candidate.workspaceData.database.data.data
    .find(x => x.tableName === 'wordRecords').rows.length, 2)
})
test('cross-account, forged ancestor hash and incomplete table payload fail closed', async () => {
  const a = snap()
  const foreign = snap()
  foreign.metadata.source.accountId = 'another-user'
  assert.equal((await inspect(a, a, foreign)).reason,
    'ancestor-workspace-account-mismatch')
  assert.equal((await inspect(a, a, a, 'f'.repeat(64))).reason,
    'ancestor-pinned-fingerprint-mismatch')
  const incomplete = snap()
  incomplete.workspaceData.database.data.data.pop()
  assert.equal((await inspect(a, a, incomplete)).status, 'blocked')
})
test('missing independent setting preserves delete without resurrecting ancestor', async () => {
  const a = snap(), l = snap(), r = snap()
  a.workspaceData.settings.values.pronunciation = 'uk'
  l.workspaceData.settings.values.pronunciation = 'uk'
  r.workspaceData.navigation.currentChapter = 1
  delete r.workspaceData.settings.values.pronunciation
  const result = await inspect(a, l, r)
  assert.equal(result.status, 'projected', result.reason)
  assert.equal('pronunciation' in result.candidate.workspaceData.settings.values,
    false)
})
