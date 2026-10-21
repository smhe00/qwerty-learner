import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m2-six-table-'))
const out = join(tmp, 'projection.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-six-table-projection.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { projectV4SixTableEvidence: project } = await import(pathToFileURL(out).href)

const t0 = 1_800_000_000
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
]
const mkWord = (attemptId, timestamp = t0) => ({
  id: 1, attemptId, dict: 'school', word: 'alpha', timeStamp: timestamp,
  chapter: -1, wrongCount: 0, mistakes: {}, timing: [],
  sourceMode: 'learn', learnItemKind: 'review',
  reviewRatingDecision: { eligible: true, rating: 'good',
    confidence: 1, reasonCodes: ['test'] },
})
const mkState = () => ({
  id: 1, dict: 'school', word: 'alpha', createdAt: t0, updatedAt: t0,
  lastReviewedAt: t0, nextReviewAt: t0 + 86_400, reviewCount: 1,
  lapseCount: 0, cleanStreak: 1, lifecycle: 'active', stateVersion: 5,
  schedulerState: { kind: 'fsrs6', difficulty: 5, stability: 3 },
})
const mkSession = (finished) => ({
  id: 1, dict: 'school', index: finished ? 1 : 0, createTime: t0,
  isFinished: finished, words: [{ name: 'alpha', trans: ['one'] }],
})
const side = (word, finished = true) => ({
  words: [word], chapters: [{
    id: 1, dict: 'school', chapter: 0, timeStamp: t0, time: 1,
    correctCount: 1, wrongCount: 0, wordCount: 1,
    correctWordIndexes: [0], wordNumber: 1, wordRecordIds: [1],
  }],
  reviewRecords: [mkSession(finished)], reviewWordStates: [mkState()],
  events: [], states: [],
})

test('read-only six-table projection retains both session origins and replays one FSRS state', () => {
  const local = side(mkWord(ids[0]))
  const remote = side(mkWord(ids[1], t0 + 70), false)
  remote.reviewWordStates[0].lastReviewedAt = t0 + 70
  const before = structuredClone({ local, remote })
  const result = project({ local, remote })
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.equal(result.stats.uniqueAttempts, 2)
  assert.equal(result.stats.sessionRowsNeedingAncestry, 2)
  assert.equal(result.stats.activeSessionRows, 1)
  assert.deepEqual(result.chapterRecords.map(row => row.wordRecordIds), [[1], [2]])
  assert.deepEqual(result.sessionEvidence.map(row => row.origin), ['local', 'remote'])
  assert.deepEqual(result.sessionEvidence.map(row => row.sourceId), [1, 1])
  assert.equal(result.reviewWordStates.length, 1)
  assert.equal(result.reviewWordStates[0].reviewCount, 2)
  assert.equal(result.reviewWordStates[0].schedulerState.kind, 'fsrs6')
  assert.deepEqual({ local, remote }, before, 'source V4 tables must be untouched')
})

test('same UUID deduplicates word evidence, never guesses session identity', () => {
  const local = side(mkWord(ids[0]))
  const remote = structuredClone(local)
  remote.words[0].id = 99
  remote.chapters[0].wordRecordIds = [99]
  const result = project({ local, remote })
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.wordRecords.length, 1)
  assert.equal(result.reviewWordStates[0].reviewCount, 1)
  assert.equal(result.sessionEvidence.length, 2)
})

test('scheduler state with missing durable Review events fails closed', () => {
  const local = side(mkWord(ids[0]))
  local.reviewWordStates[0].reviewCount = 2
  const result = project({ local, remote: {
    words: [], chapters: [], reviewRecords: [], reviewWordStates: [],
    events: [], states: [],
  } })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'missing-scheduler-source-evidence')
})

test('manual exclusion and old scheduler cannot disappear during replay', () => {
  const local = side(mkWord(ids[0]))
  const remote = { words: [], chapters: [], reviewRecords: [],
    reviewWordStates: [], events: [], states: [] }
  local.reviewWordStates[0].lifecycle = 'excluded'
  local.reviewWordStates[0].exclusion = { reason: 'manual', excludedAt: t0 }
  assert.equal(project({ local, remote }).reason, 'unreplayed-learning-exclusion')
  local.reviewWordStates[0].lifecycle = 'active'
  delete local.reviewWordStates[0].exclusion
  local.reviewWordStates[0].schedulerState = {
    kind: 'basic-v2', stage: 1, intervalDays: 1 }
  assert.equal(project({ local, remote }).reason, 'unverified-legacy-scheduler')
})

test('duplicate review session keys are detected per origin', () => {
  const local = side(mkWord(ids[0]))
  local.reviewRecords.push(structuredClone(local.reviewRecords[0]))
  assert.equal(project({ local, remote: {
    words: [], chapters: [], reviewRecords: [], reviewWordStates: [],
    events: [], states: [],
  } }).reason, 'invalid-review-session')
})

test('concurrent cross-device Good is quarantined before six-table FSRS replay', () => {
  const local = side(mkWord(ids[0]))
  const remote = side(mkWord(ids[1], t0 + 10))
  assert.equal(project({ local, remote }).reason, 'fsrs:concurrent-review-conflict')
})

test('immutable session UUID can identify identical snapshots despite numeric ID relocation', () => {
  const local = side(mkWord(ids[0]))
  const remote = structuredClone(local)
  const uuid = '00000000-0000-4000-8000-000000000099'
  local.reviewRecords[0].sessionId = uuid
  remote.reviewRecords[0].sessionId = uuid
  remote.reviewRecords[0].id = 100
  remote.words[0].id = 99
  remote.chapters[0].wordRecordIds = [99]
  const result = project({ local, remote })
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.stats.matchedSessionPairs, 1)
  assert.equal(result.stats.sessionRowsNeedingAncestry, 2)
  assert.equal(result.convergenceComplete, false)
  assert.deepEqual(result.sessionEvidence.map(item => item.sessionId), [uuid, uuid])
})

test('same session UUID with divergent cursor must be blocked rather than merged', () => {
  const local = side(mkWord(ids[0]))
  const remote = structuredClone(local)
  const uuid = '00000000-0000-4000-8000-000000000098'
  local.reviewRecords[0].sessionId = uuid
  remote.reviewRecords[0].sessionId = uuid
  remote.reviewRecords[0].index = 0
  remote.reviewRecords[0].isFinished = false
  assert.equal(project({ local, remote }).reason,
    'divergent-review-session-identity')
})

test('duplicate or malformed session UUID is rejected; legacy collision is never deduped', () => {
  const local = side(mkWord(ids[0]))
  const remote = structuredClone(local)
  const uuid = '00000000-0000-4000-8000-000000000097'
  local.reviewRecords[0].sessionId = 'fake-id'
  assert.equal(project({ local, remote }).reason, 'invalid-review-session-id')
  local.reviewRecords[0].sessionId = uuid
  local.reviewRecords.push({ ...structuredClone(local.reviewRecords[0]), id: 2 })
  assert.equal(project({ local, remote }).reason, 'invalid-review-session-id')
  delete local.reviewRecords[0].sessionId
  delete local.reviewRecords[1].sessionId
  const valid = project({ local, remote })
  assert.equal(valid.status, 'projected', valid.reason)
  assert.equal(valid.stats.matchedSessionPairs, 0)
  assert.equal(valid.sessionEvidence.length, 3)
})
