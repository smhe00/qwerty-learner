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
const activeBundle = join(dir, 'fsrs.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/v4-disjoint-word-candidate.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile: output, tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile: workspace, tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/review/fsrs/active.ts')],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile: activeBundle, tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { force: true, recursive: true }))
const { previewDisjointWordV4: preview } = await import(pathToFileURL(output).href)
const { workspaceFingerprintV4: hash } = await import(pathToFileURL(workspace).href)
const { rebuildActiveFsrsStateFromWordRecords: replay } =
  await import(pathToFileURL(activeBundle).href)
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
test('same word on both machines is a mergeable learning fact, not a time conflict', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords').push(record('apple', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('apple', 2, uuid(3)))
  const p = await inspect(a, l, r)
  assert.equal(p.status, 'projected', p.reason)
  assert.equal(p.chronologicallyReplayedWords, 1)
  assert.deepEqual(rows(p.candidate, 'wordRecords').map(x => x.attemptId),
    [uuid(1), uuid(2), uuid(3)])
  assert.deepEqual(rows(p.candidate, 'wordRecords').map(x => x.id), [1,2,3])
  assert.equal(p.publishReady, false)
})
test('same attempt ID reused in another word blocks even if local IDs differ', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l, 'wordRecords').push(record('banana', 2, uuid(2)))
  rows(r, 'wordRecords').push(record('cherry', 2, uuid(2)))
  assert.equal((await inspect(a,l,r)).reason,'disjoint-contradictory-attempt')
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
test('protected tables and malformed ReviewSessions block; uncontested DailySession is kept', async () => {
  for (const name of ['chapterRecords','reviewRecords',
    'achievementEvents','achievementStates']) {
    const a = snap(), l = structuredClone(a), r = structuredClone(a)
    rows(l,name).push({ id: 2, test: 'changed' })
    assert.equal((await inspect(a,l,r)).reason,
      name === 'reviewRecords'
        ? 'disjoint-review-sessions:invalid-or-legacy-session'
        : 'disjoint-protected-table-changed:' + name)
  }
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  l.workspaceData.learnRuntime.dailySessions.school = {
    version: 1, dict: 'school', dateKey: '2026-10-22',
    sessionId: uuid(8), startedAt: 1800000000, status: 'active',
    dailyNewTarget: 20, plannedNewWords: 1, blockCount: 1,
    plannedReviewWords: [], carryOverAcquisitionWords: [],
    completedBlockIds: [],
  }
  const oneSide = await inspect(a,l,r)
  assert.equal(oneSide.status, 'projected', oneSide.reason)
  assert.deepEqual(oneSide.candidate.workspaceData.learnRuntime.dailySessions,
    l.workspaceData.learnRuntime.dailySessions)
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

test('re-upload of same independently identified attempt once per device is idempotent', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l,'wordRecords').push(record('banana',2,uuid(2)))
  rows(r,'wordRecords').push(record('banana',2,uuid(2)))
  const p = await inspect(a,l,r)
  assert.equal(p.status,'projected',p.reason)
  assert.equal(p.localNewAttempts,1)
  assert.equal(p.remoteNewAttempts,1)
  assert.equal(rows(p.candidate,'wordRecords').length,2)
  assert.equal(rows(p.candidate,'wordRecords')[1].attemptId,uuid(2))
})
const daily = (dict, marker = 1) => ({
  version:1,sessionId:dict+':2026-10-22:'+marker,
  dict,dateKey:'2026-10-22',startedAt:1800000000+marker,
  status:'active',dailyNewTarget:1,plannedNewWords:1,
  plannedReviewWords:[],carryOverAcquisitionWords:[],
  accumulatedActiveSeconds:0,completedBlockIds:[],blockCount:0,
})
test('different dictionaries can merge independently changed DailySession plans', async()=>{
  const a=snap(),l=structuredClone(a),r=structuredClone(a)
  l.workspaceData.learnRuntime.dailySessions.school=daily('school')
  r.workspaceData.learnRuntime.dailySessions.cet4=daily('cet4')
  rows(l,'wordRecords').push(record('banana',2,uuid(2)))
  rows(r,'wordRecords').push(record('cherry',2,uuid(3),{dict:'cet4'}))
  const result=await inspect(a,l,r)
  assert.equal(result.status,'projected',result.reason)
  assert.deepEqual(Object.keys(result.candidate.workspaceData.learnRuntime.dailySessions),
    ['cet4','school'])
  assert.equal(rows(result.candidate,'wordRecords').length,3)
  const swapped=await inspect(a,r,l)
  assert.equal(swapped.status,'projected',swapped.reason)
  assert.equal(swapped.candidateFingerprint,result.candidateFingerprint)
})
test('divergent DailySessions for the same dictionary block rather than select a winner',async()=>{
  const a=snap(),l=structuredClone(a),r=structuredClone(a)
  l.workspaceData.learnRuntime.dailySessions.school=daily('school',1)
  r.workspaceData.learnRuntime.dailySessions.school=daily('school',2)
  const result=await inspect(a,l,r)
  assert.equal(result.status,'blocked')
  assert.equal(result.reason,'disjoint-daily-session-conflict:school')
})
test('one-sided DailySession must not erase opposite-device activity in its dictionary',async()=>{
  const a=snap(),l=structuredClone(a),r=structuredClone(a)
  l.workspaceData.learnRuntime.dailySessions.school=daily('school')
  rows(r,'wordRecords').push(record('banana',2,uuid(2)))
  const result=await inspect(a,l,r)
  assert.equal(result.status,'blocked')
  assert.equal(result.reason,'disjoint-daily-session-conflict:school')
})
test('deleting ancestor DailySession must not be inferred from an absent key',async()=>{
  const a=snap()
  a.workspaceData.learnRuntime.dailySessions.school=daily('school')
  const l=structuredClone(a),r=structuredClone(a)
  delete l.workspaceData.learnRuntime.dailySessions.school
  const result=await inspect(a,l,r)
  assert.equal(result.status,'blocked')
  assert.equal(result.reason,'disjoint-daily-session-removal-unverified:school')
})

test('same word study facts with different scores and no 60s conflict are never dropped', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  const g = record('apple',2,uuid(2),{ chapter:-1,
    timeStamp:1800001000, learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating:'good',confidence:1,reasonCodes:['test']} })
  const f = record('apple',2,uuid(3),{ chapter:-1,
    timeStamp:1800001000, learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating:'again',confidence:1,reasonCodes:['test']} })
  rows(l,'wordRecords').push(g)
  rows(r,'wordRecords').push(f)
  const p = await inspect(a,l,r)
  // The preserved FSRS base state in this fixture is not a verified replay.
  // Unsafe missing/stale reviewWordStates must block, not invent a durable state.
  assert.equal(p.status,'blocked')
  assert.match(p.reason,/unverified-device-fsrs|missing-fsrs-history/)
})

test('two real independent reviews on the SAME word are both replayed into durable V4', async () => {
  const a = snap()
  // Derive all scheduler states from actual immutable attempt histories.
  const base = replay('school','apple',rows(a,'wordRecords'))
  assert.ok(base)
  rows(a,'reviewWordStates')[0] = { ...base, id: 1 }
  const l = structuredClone(a), r = structuredClone(a)
  const rated = (id,rating,stamp) => record('apple',2,uuid(id),{
    chapter:-1,timeStamp:stamp,learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating,confidence:1,
      reasonCodes:['test']},
    reviewBaseStateFingerprint:'e'.repeat(64),
  })
  const good = rated(2,'good',1800001000)
  const again = rated(3,'again',1800001000)
  rows(l,'wordRecords').push(good)
  rows(r,'wordRecords').push(again)
  rows(l,'reviewWordStates')[0] = {
    ...replay('school','apple',rows(l,'wordRecords')),id:1 }
  rows(r,'reviewWordStates')[0] = {
    ...replay('school','apple',rows(r,'wordRecords')),id:1 }
  const before = structuredClone({ a,l,r })
  const merged = await inspect(a,l,r)
  assert.equal(merged.status,'projected',merged.reason)
  assert.equal(merged.chronologicallyReplayedWords,1)
  assert.equal(merged.candidateFingerprint,await hash(merged.candidate))
  assert.equal(merged.publishReady,false)
  const finalWords = rows(merged.candidate,'wordRecords')
  assert.equal(finalWords.length,3)
  assert.deepEqual(finalWords.map(x=>x.attemptId),[uuid(1),uuid(2),uuid(3)])
  assert.deepEqual(finalWords.map(x=>x.id),[1,2,3])
  const state = rows(merged.candidate,'reviewWordStates')[0]
  assert.equal(state.id,1)
  assert.equal(state.reviewCount,2)
  assert.equal(state.lastOutcome,'again')
  const replayed = replay('school','apple',finalWords)
  assert.equal(state.reviewCount,replayed.reviewCount)
  assert.equal(state.nextReviewAt,replayed.nextReviewAt)
  assert.equal(state.schedulerState.stability,replayed.schedulerState.stability)
  assert.deepEqual({a,l,r},before)
  const reversed = await inspect(a,r,l)
  assert.equal(reversed.status,'projected',reversed.reason)
  assert.equal(reversed.candidateFingerprint,merged.candidateFingerprint)
})
test('a forged per-device review count is refused even if its word events are intact', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  const ev = record('apple',2,uuid(2),{chapter:-1,learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating:'good',reasonCodes:['test']} })
  rows(l,'wordRecords').push(ev)
  rows(r,'wordRecords').push(record('apple',2,uuid(3),{
    chapter:-1,learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating:'again',reasonCodes:['test']} }))
  rows(l,'reviewWordStates')[0].reviewCount=999
  assert.equal((await inspect(a,l,r)).status,'blocked')
})

test('single-device rated review is replayed, never trusted from cached FSRS', async () => {
  const a = snap()
  const seeded = replay('school', 'apple', rows(a, 'wordRecords'))
  assert.ok(seeded)
  rows(a, 'reviewWordStates')[0] = { ...seeded, id: 1 }
  const l = structuredClone(a), r = structuredClone(a)
  const grade = record('apple', 2, uuid(2), {
    chapter: -1, timeStamp: 1800001000, learnItemKind: 'review',
    reviewRatingDecision: { eligible: true, rating: 'good',
      confidence: 1, reasonCodes: ['test'] },
  })
  rows(l, 'wordRecords').push(grade)
  const trusted = replay('school','apple', rows(l, 'wordRecords'))
  assert.ok(trusted)
  rows(l, 'reviewWordStates')[0] = { ...trusted, id: 1 }
  const projected = await inspect(a, l, r)
  assert.equal(projected.status, 'projected', projected.reason)
  assert.equal(projected.candidateFingerprint, await hash(projected.candidate))
  assert.equal(rows(projected.candidate, 'reviewWordStates')[0].reviewCount, 1)
  assert.equal(rows(projected.candidate, 'reviewWordStates')[0].nextReviewAt,
    trusted.nextReviewAt)
  assert.deepEqual(rows(projected.candidate, 'wordRecords').map(x => x.id),
    [1, 2])
  const reverse = await inspect(a, r, l)
  assert.equal(reverse.status, 'projected', reverse.reason)
  assert.equal(reverse.candidateFingerprint, projected.candidateFingerprint)
  assert.equal(projected.publishReady, false)
})

test('single-device stale, fabricated or missing scheduler evidence blocks', async () => {
  const a = snap()
  rows(a, 'reviewWordStates')[0] = {
    ...replay('school','apple',rows(a,'wordRecords')), id: 1 }
  const good = record('apple',2,uuid(2), {
    chapter:-1,timeStamp:1800001000, learnItemKind:'review',
    reviewRatingDecision:{eligible:true,rating:'good',reasonCodes:['test']},
  })
  const stale = structuredClone(a), untouched = structuredClone(a)
  rows(stale, 'wordRecords').push(good)
  assert.equal((await inspect(a,stale,untouched)).reason,
    'disjoint-single-side-unverified-device-fsrs:local')

  const forged = structuredClone(stale)
  rows(forged,'reviewWordStates')[0] = {
    ...replay('school','apple',rows(forged,'wordRecords')), id:1 }
  rows(forged,'reviewWordStates')[0].schedulerState.stability += 0.5
  assert.equal((await inspect(a,untouched,forged)).reason,
    'disjoint-single-side-unverified-device-fsrs:remote')

  const lost = structuredClone(forged)
  rows(lost,'reviewWordStates').length = 0
  assert.equal((await inspect(a,lost,untouched)).status,'blocked')
})

test('same UUID with different origin-local shadow remains order independent', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(l,'wordRecords').push(record('banana',2,uuid(2),{
    fsrsShadow:{version:1,sourceRecordId:2,marker:'first'},
  }))
  rows(r,'wordRecords').push(record('banana',99,uuid(2),{
    timeStamp:1800000002,
    fsrsShadow:{version:1,sourceRecordId:99,marker:'second'},
  }))
  const left = await inspect(a,l,r)
  const right = await inspect(a,r,l)
  assert.equal(left.status,'projected',left.reason)
  assert.equal(right.status,'projected',right.reason)
  assert.equal(left.candidateFingerprint,right.candidateFingerprint,
    'cross-device order cannot change canonical V4 bytes')
  const merged = rows(left.candidate,'wordRecords')
  assert.equal(merged.length,2)
  assert.equal(merged[1].attemptId,uuid(2))
  assert.equal(merged[1].id,2)
  assert.equal(merged[1].fsrsShadow.sourceRecordId,2)
})

const session = (id, uuidId = id) => ({
  id, sessionId: uuid(uuidId), dict: 'school', index: 0,
  createTime: 1800000000, isFinished: false, sessionKind: 'review',
  words: [{name:'apple',trans:['苹果']}, {name:'banana',trans:['香蕉']}],
})
test('different new ReviewSessions are merged with deterministic numeric IDs', async () => {
  const a = snap(), l = structuredClone(a), r = structuredClone(a)
  rows(a,'reviewRecords').push(session(1))
  for (const branch of [l,r]) {
    branch.workspaceData.database = structuredClone(a.workspaceData.database)
  }
  rows(l,'reviewRecords').push(session(2,2))
  rows(r,'reviewRecords').push(session(2,3))
  rows(l,'wordRecords').push(record('banana',2,uuid(5)))
  rows(r,'wordRecords').push(record('cherry',2,uuid(6)))
  const before = structuredClone({a,l,r})
  const p = await inspect(a,l,r)
  assert.equal(p.status,'projected',p.reason)
  const sessions = rows(p.candidate,'reviewRecords')
  assert.deepEqual(sessions.map(s=>s.sessionId),[uuid(1),uuid(2),uuid(3)])
  assert.deepEqual(sessions.map(s=>s.id),[1,2,3])
  assert.deepEqual(rows(p.candidate,'wordRecords').map(w=>w.id),[1,2,3])
  assert.equal(await hash(p.candidate),p.candidateFingerprint)
  const swapped = await inspect(a,r,l)
  assert.equal(swapped.status,'projected',swapped.reason)
  assert.equal(swapped.candidateFingerprint,p.candidateFingerprint)
  assert.equal(p.publishReady,false)
  assert.deepEqual({a,l,r},before)
})
test('ancestor session cursor may advance on one device without losing new word facts', async () => {
  const a=snap()
  rows(a,'reviewRecords').push(session(1))
  const l=structuredClone(a),r=structuredClone(a)
  rows(l,'reviewRecords')[0].index=1
  rows(l,'wordRecords').push(record('banana',2,uuid(2)))
  rows(r,'wordRecords').push(record('cherry',2,uuid(3)))
  const p=await inspect(a,l,r)
  assert.equal(p.status,'projected',p.reason)
  assert.equal(rows(p.candidate,'reviewRecords')[0].index,1)
  assert.equal(rows(p.candidate,'reviewRecords')[0].id,1)
  assert.equal(rows(p.candidate,'wordRecords').length,3)
})
test('concurrently divergent session cursors block even if word events can merge',async()=>{
  const a=snap()
  rows(a,'reviewRecords').push(session(1))
  const l=structuredClone(a),r=structuredClone(a)
  rows(l,'reviewRecords')[0].index=1
  rows(r,'reviewRecords')[0].index=2
  rows(l,'wordRecords').push(record('banana',2,uuid(2)))
  rows(r,'wordRecords').push(record('cherry',2,uuid(3)))
  const p=await inspect(a,l,r)
  assert.equal(p.status,'blocked')
  assert.equal(p.reason,'disjoint-review-sessions:concurrent-session-advance-conflict')
})
test('unchanged legacy ReviewSessions coexist with independently created UUID sessions', async () => {
  const a=snap()
  const old=session(7)
  delete old.sessionId
  rows(a,'reviewRecords').push(old)
  const l=structuredClone(a),r=structuredClone(a)
  // Two browsers both allocate local ID 8; UUID is their global identity.
  rows(l,'reviewRecords').push(session(8,11))
  rows(r,'reviewRecords').push(session(8,12))
  const result=await inspect(a,l,r)
  assert.equal(result.status,'projected',result.reason)
  assert.deepEqual(rows(result.candidate,'reviewRecords').map(s=>s.id),[7,8,9])
  assert.deepEqual(rows(result.candidate,'reviewRecords')[0],old,
    'legacy row must remain byte-for-byte unchanged')
  assert.deepEqual(new Set(rows(result.candidate,'reviewRecords')
    .slice(1).map(s=>s.sessionId)),new Set([uuid(11),uuid(12)]))
  const swapped=await inspect(a,r,l)
  assert.equal(swapped.status,'projected',swapped.reason)
  assert.equal(swapped.candidateFingerprint,result.candidateFingerprint)
  assert.equal(result.publishReady,false)
})
test('legacy session rewrite still blocks when other UUID sessions are valid', async () => {
  const a=snap()
  const old=session(7)
  delete old.sessionId
  rows(a,'reviewRecords').push(old)
  const l=structuredClone(a),r=structuredClone(a)
  rows(l,'reviewRecords').push(session(8,11))
  rows(r,'reviewRecords').push(session(8,12))
  rows(r,'reviewRecords')[0].index=1
  const result=await inspect(a,l,r)
  assert.equal(result.status,'blocked')
  assert.equal(result.reason,'disjoint-v4-invalid:disjoint-legacy-session-changed')
  // A deleted legacy row is not a legitimate cross-device deletion.
  rows(r,'reviewRecords').shift()
  const missing=await inspect(a,l,r)
  assert.equal(missing.status,'blocked')
  assert.equal(missing.reason,'disjoint-v4-invalid:disjoint-legacy-session-changed')
})

test('legacy session cannot be rewritten or dropped by a competing branch',async()=>{
  const a=snap()
  const legacy=session(1)
  delete legacy.sessionId
  rows(a,'reviewRecords').push(legacy)
  const l=structuredClone(a),r=structuredClone(a)
  rows(l,'reviewRecords')[0].index=1
  assert.equal((await inspect(a,l,r)).status,'blocked')
  const gone=structuredClone(a)
  rows(gone,'reviewRecords').pop()
  assert.equal((await inspect(a,gone,r)).status,'blocked')
  // Unchanged legacy history is preserved byte-for-byte.
  rows(l,'reviewRecords')[0].index=0
  rows(l,'wordRecords').push(record('banana',2,uuid(2)))
  const p=await inspect(a,l,r)
  assert.equal(p.status,'projected',p.reason)
  assert.deepEqual(rows(p.candidate,'reviewRecords'),rows(a,'reviewRecords'))
})
