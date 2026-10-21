import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-disjoint-v4-'))
const output = join(dir, 'disjoint.mjs'), workspace = join(dir, 'v4.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/v4-disjoint-word-candidate.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile: output, tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile: workspace, tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { force: true, recursive: true }))
const { previewDisjointWordV4: preview } = await import(pathToFileURL(output).href)
const { workspaceFingerprintV4: hash } = await import(pathToFileURL(workspace).href)
const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
const accountId = 'account-immutable-disjoint'
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const record = (word, id, attemptId, extra = {}) => ({
  id, attemptId, dict: 'school', word, timeStamp: 1800000000 + id,
  chapter: 0, timing: [], wrongCount: 0, mistakes: {},
  sourceMode: 'learn', learnItemKind: 'acquisition', ...extra,
})
const fsrs = (word, id, count = 0) => ({
  id, dict: 'school', word, createdAt: 1800000000,
  updatedAt: 1800000000 + count, nextReviewAt: 1800020000 + count,
  reviewCount: count, lapseCount: 0, cleanStreak: 0,
  lifecycle: 'active', stateVersion: 5,
  schedulerState: { kind: 'fsrs6', difficulty: 5, stability: 4 },
})
function snap() {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-22T00:00:00Z',
      source: { kind: 'account', accountId } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1,
        data: { databaseName: 'RecordDB', databaseVersion: 6,
          tables: names.map(name => ({ name, schema: '++id' })),
          data: names.map(tableName => ({
            tableName, inbound: true,
            rows: tableName === 'wordRecords' ? [record('apple', 1, uuid(1))] :
              tableName === 'reviewWordStates' ? [fsrs('apple', 1)] : [],
          })),
        } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'school', currentChapter: 0 },
    },
  }
}
function rows(s, name) {
  return s.workspaceData.database.data.data.find(x => x.tableName === name).rows
}
async function inspect(a, l, r, pin) {
  return preview({ accountId, ancestor: a, local: l, remote: r,
    pinnedAncestorFingerprint: pin ?? await hash(a) })
}
test('different words are unioned into full V4, two devices may reuse numeric ID=2', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords').push(record('banana', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('cherry', 2, uuid(3)))
  rows(l, 'reviewWordStates').push(fsrs('banana', 2))
  rows(r, 'reviewWordStates').push(fsrs('cherry', 2))
  l.workspaceData.settings.values.pronunciation = 'en'
  r.workspaceData.settings.values.isOpenDarkModeAtom = true
  const before = structuredClone({ a, l, r })
  const p = await inspect(a, l, r)
  assert.equal(p.status, 'projected', p.reason)
  assert.equal(p.publishReady, false)
  assert.equal(p.convergenceComplete, false)
  assert.equal(p.localNewAttempts, 1)
  assert.equal(p.remoteNewAttempts, 1)
  assert.equal(p.updatedWordStates, 2)
  assert.deepEqual(rows(p.candidate, 'wordRecords').map(x => x.word),
    ['apple','banana','cherry'])
  assert.deepEqual(rows(p.candidate, 'wordRecords').map(x => x.id), [1,2,3])
  assert.deepEqual(rows(p.candidate, 'reviewWordStates').map(x => x.id), [1,2,3])
  assert.deepEqual(p.candidate.workspaceData.settings.values,
    { isOpenDarkModeAtom: true, pronunciation: 'en' })
  assert.equal(await hash(p.candidate), p.candidateFingerprint)
  assert.equal(p.candidate.workspaceData.database.data.data.length, 6)
  assert.deepEqual({ a, l, r }, before)
})
test('unmodified ancestor reference IDs survive, so four tables remain unchanged', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(a, 'chapterRecords').push({ id: 1, dict: 'school', chapter: 0,
    timeStamp: 1800000000, time: 1, correctCount: 1, wrongCount: 0,
    wordCount: 1, correctWordIndexes: [0], wordNumber: 1, wordRecordIds: [1] })
  l.workspaceData.database = structuredClone(a.workspaceData.database)
  r.workspaceData.database = structuredClone(a.workspaceData.database)
  rows(l, 'wordRecords').push(record('banana', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('cherry', 2, uuid(3)))
  const p = await inspect(a, l, r)
  assert.equal(p.status, 'projected', p.reason)
  assert.deepEqual(rows(p.candidate, 'chapterRecords'), rows(a, 'chapterRecords'))
  assert.deepEqual(rows(p.candidate, 'chapterRecords')[0].wordRecordIds,[1])
})
test('same word edited on both machines cannot silently double-grade or overwrite', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords').push(record('apple', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('apple', 2, uuid(3)))
  const p = await inspect(a, l, r)
  assert.equal(p.status,'blocked')
  assert.match(p.reason,/disjoint-overlapping-word/)
  assert.equal(p.candidate, undefined)
})
test('same attempt ID reused in another word blocks even if local IDs differ', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords').push(record('banana', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('cherry', 2, uuid(2)))
  assert.equal((await inspect(a,l,r)).reason,'disjoint-unverified-new-attempt')
})
test('historic rows cannot be removed or silently rewritten', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords')[0].word = 'mutated'
  assert.equal((await inspect(a,l,r)).reason,
    'disjoint-v4-invalid:disjoint-local-ancestor-record-rewritten')
  const d = structuredClone(a)
  rows(d, 'wordRecords').pop()
  assert.equal((await inspect(a,d,r)).status,'blocked')
})
test('changes to chapter, sessions, achievements or DailySession are blocked', async () => {
  for (const name of ['chapterRecords','reviewRecords',
    'achievementEvents','achievementStates']) {
    const a = snap(), l = structuredClone(a), r = structuredClone(a)
    rows(l,name).push({ id: 2, test: 'changed' })
    assert.equal((await inspect(a,l,r)).reason,
      'disjoint-protected-table-changed:' + name)
  }
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  l.workspaceData.learnRuntime.dailySessions.school = {
    version: 1, dict: 'school', dateKey: '2026-10-22',
    sessionId: uuid(8), startedAt: 1800000000, status: 'active',
    dailyNewTarget: 20, plannedNewWords: 1, blockCount: 1,
    plannedReviewWords: [], carryOverAcquisitionWords: [],
    completedBlockIds: [],
  }
  assert.equal((await inspect(a,l,r)).reason, 'disjoint-daily-session-changed')
})
test('FSRS scheduler updates require a same-side new attempt and cannot regress', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'reviewWordStates')[0].reviewCount = 1
  assert.equal((await inspect(a,l,r)).reason,
    'disjoint-scheduler-state-without-new-attempt')
  rows(l, 'wordRecords').push(record('apple', 2, uuid(2)))
  const ok = await inspect(a,l,r)
  assert.equal(ok.status, 'projected', ok.reason)
  const second = structuredClone(a)
  rows(second,'reviewWordStates')[0].reviewCount = -1
  rows(second,'wordRecords').push(record('apple',2,uuid(2)))
  assert.equal((await inspect(a,second,r)).status,'blocked')
})
test('legacy new attempt, forged ancestor or cross-account V4 cannot be merged', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l,'wordRecords').push(record('banana',2,undefined))
  assert.equal((await inspect(a,l,r)).reason, 'disjoint-unverified-new-attempt')
  assert.equal((await inspect(a,a,a,'f'.repeat(64))).reason,
    'ancestor-pinned-fingerprint-mismatch')
  r.metadata.source.accountId = 'other'
  assert.equal((await inspect(a,a,r)).reason,
    'ancestor-workspace-account-mismatch')
})
test('new FSRS shadow numeric reference must be rebased to its new primary key', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  const newRow = record('banana', 2, uuid(2), {
    fsrsShadow: { version: 1, sourceRecordId: 2, marker: 'proof' },
  })
  rows(l,'wordRecords').push(newRow)
  rows(r,'wordRecords').push(record('cherry',2,uuid(3)))
  const p = await inspect(a,l,r)
  assert.equal(p.status,'projected',p.reason)
  const banana = rows(p.candidate,'wordRecords').find(x=>x.word==='banana')
  assert.equal(banana.fsrsShadow.sourceRecordId,banana.id)
})
