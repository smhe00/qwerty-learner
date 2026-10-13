import assert from 'node:assert/strict'
import { isLearningAttemptId, newLearningAttemptId } from '../../src/utils/db/attempt-identity'
import test from 'node:test'
import { compactTypingWordRecord } from '../../src/utils/db/word-record-retention'
import { analyzeV4SnapshotSize } from '../../src/sync/v4-size-audit'
import { compactFinishedReviewRecord } from '../../src/utils/db/review-record-retention'
import { collectPendingAcquisitionStates } from '../../src/learn/acquisition-recovery'
import { createLearnAcquisitionState } from '../../src/learn/acquisition'
import type { IReviewRecord } from '../../src/utils/db/record'
import { summarizeWordHistory } from '../../src/review/features'
import { buildOrthographyProfile } from '../../src/review/profile'
import { rebuildActiveFsrsStateFromWordRecords } from '../../src/review/fsrs/active'
import type { IWordRecord } from '../../src/utils/db/record'
import type { WorkspaceSnapshotV4 } from '../../src/sync/workspace-v4'

const NOW = 1_800_000_000
const DAY = 86_400

function typing(id: number, timeStamp = NOW - 120 * DAY): IWordRecord {
  return {
    id, dict: 'test', word: 'ability', chapter: 0, timeStamp,
    timing: [128, 190, 140, 110, 270, 101],
    mistakes: { 2: ['x', 'c'] }, wrongCount: 2, sourceMode: 'typing',
    typingTelemetry: {
      telemetryVersion: 2, firstKeyLatencyMs: 310,
      attempts: [
        { startLatencyMs: 310, durationMs: 700,
          correctPrefixLength: 2, result: 'wrong', wrongIndex: 2,
          wrongKey: 'x', interKeyIntervalsMs: [120, 190, 200] },
        { startLatencyMs: 250, durationMs: 800,
          correctPrefixLength: 7, result: 'clean',
          interKeyIntervalsMs: [90, 120, 120, 100, 140] },
      ],
    },
    exerciseCondition: {
      version: 1, purpose: 'probe', source: 'adaptive-policy',
      audio: 'none', meaning: 'visible', phonetic: 'hidden',
      letters: { mode: 'all-hidden' }, probeDimension: 'none',
    },
    reviewPolicyDecision: {
      version: 1, policyVersion: 'test', reasonCodes: ['test'],
      conditionVersion: 1,
    },
    reviewEvidence: {
      version: 1, memoryGrade: 'good', errorCause: 'motor',
      confidence: 1, evidenceStrength: 1,
      retrievalValidity: 'independent', reasonCodes: ['test'],
    },
  }
}

function learn(id: number, kind: 'acquisition' | 'review',
  timeStamp = NOW): IWordRecord {
  return {
    ...typing(id, timeStamp), chapter: -1, sourceMode: 'learn',
    learnItemKind: kind,
    ...(kind === 'review'
      ? { reviewRatingDecision: {
        eligible: true as const, rating: 'good' as const,
        confidence: 1, reasonCodes: ['review'],
      } }
      : {}),
  }
}

test('Typing compact is pure/idempotent and preserves historical charts and spelling profile', () => {
  const source = typing(1)
  const sourceJson = JSON.stringify(source)
  const compact = compactTypingWordRecord(source)
  assert.equal(JSON.stringify(source), sourceJson, 'input must stay immutable')
  assert.notEqual(compact, source)
  assert.equal(compact.sourceMode, 'typing')
  assert.equal(compact.typingTelemetry?.firstKeyLatencyMs, 310)
  assert.equal(compact.typingTelemetry?.attempts[0].wrongIndex, 2)
  assert.equal(compact.typingTelemetry?.attempts[0].wrongKey, 'x')
  assert.equal(compact.typingTelemetry?.attempts[0].interKeyIntervalsMs, undefined)
  for (const key of ['reviewEvidence', 'reviewPolicyDecision', 'exerciseCondition'] as const) {
    assert.equal(compact[key], undefined)
  }
  assert.deepEqual(compact.mistakes, source.mistakes)
  assert.deepEqual(compact.timing, source.timing)
  assert.equal(compact.wrongCount, source.wrongCount)
  assert.deepEqual(summarizeWordHistory([compact]), summarizeWordHistory([source]))
  assert.deepEqual(buildOrthographyProfile(source.word, [compact]),
    buildOrthographyProfile(source.word, [source]))
  assert.deepEqual(compactTypingWordRecord(compact), compact)
  assert.ok(JSON.stringify(compact).length < JSON.stringify(source).length)
})

test('FSRS and unknown/legacy/eligible Learn rows are never compacted', () => {
  const acquisition = learn(2, 'acquisition', NOW - 6 * DAY)
  const review = learn(3, 'review', NOW - 5 * DAY)
  const protectedTyping = { ...typing(4), reviewRatingDecision: {
    eligible: true as const, rating: 'good' as const,
    confidence: 1, reasonCodes: [],
  } }
  const legacy = { ...typing(5), sourceMode: undefined }
  for (const row of [acquisition, review, protectedTyping, legacy]) {
    assert.equal(compactTypingWordRecord(row), row)
  }
  const before = rebuildActiveFsrsStateFromWordRecords('test', 'ability',
    [typing(1), acquisition, review])
  const after = rebuildActiveFsrsStateFromWordRecords('test', 'ability',
    [compactTypingWordRecord(typing(1)), acquisition, review])
  assert.deepEqual(after, before)
})

test('V4 gzip audit is read only, preserves all Learn rows, and measures full archive', async () => {
  const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
    'reviewWordStates', 'achievementEvents', 'achievementStates']
  const old = typing(1)
  const recent = typing(2, NOW - DAY)
  const learned = learn(3, 'review', NOW - 130 * DAY)
  const snapshot: WorkspaceSnapshotV4 = {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'anonymous' }, createdAt: '2026-10-13T00:00:00.000Z' },
    workspaceData: {
      database: {
        formatName: 'dexie',
        data: {
          tables: names.map(name => ({ name })),
          data: names.map(name => ({
            tableName: name, rows: name === 'wordRecords' ? [old, recent, learned] : [],
          })),
        },
      },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'test', currentChapter: 0 },
    },
  }
  const before = JSON.stringify(snapshot)
  const report = await analyzeV4SnapshotSize(snapshot, NOW)
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal(report.tables.length, 6)
  assert.equal(report.tables.find(item => item.name === 'wordRecords')?.rows, 3)
  assert.equal(report.oldTypingCandidates, 1)
  assert.equal(report.finishedReviewSessions, 0)
  assert.equal(report.unfinishedReviewSessions, 0)
  assert.ok(report.projectedGzipBytesAfterCompletedSessionCompaction > 0)
  assert.equal(report.achievementEventZeroMetrics, 0)
  assert.ok(report.rawBytes > report.gzipBytes)
  assert.ok(report.httpBase64Bytes >= report.gzipBytes)
  assert.ok(Number.isSafeInteger(report.projectedGzipBytesAfterTypingCompaction))
  assert.ok(report.projectedGzipBytesAfterTypingCompaction > 0)
  // Small fixtures can gzip worse after removing fields because the shared
  // dictionary changes; never promise a saving before measuring the full V4.
})

test('finished session compaction keeps terminal state, acquisition recovery and goal', () => {
  const acquired = createLearnAcquisitionState()
  const session: IReviewRecord = {
    id: 77, dict: 'test', index: 2, createTime: NOW - DAY,
    isFinished: true, sessionKind: 'mixed' as const,
    words: [{
      name: 'ability', trans: ['能力'], usphone: 'a', ukphone: 'a',
      example: [{ en: 'ability matters', cn: '能力重要', start: 0, end: 7 }],
    }],
    acquisitionStates: { ability: acquired },
    exercisePlans: {},
    hintStates: {},
    recommendedGoal: { version: 1 as const, kind: 'session-completion' as const, targetUniqueWords: 1 },
  }
  // Restore only the pending acquisition state; the completed session's
  // former word payload and hint machine cannot be resumed.
  const original = JSON.stringify(session)
  const compact = compactFinishedReviewRecord(session)
  assert.equal(JSON.stringify(session), original)
  assert.deepEqual(compact.words, [])
  assert.deepEqual(compact.acquisitionStates, session.acquisitionStates)
  assert.equal(compact.id, 77)
  assert.equal(compact.index, 2)
  assert.equal(compact.isFinished, true)
  assert.deepEqual(compact.recommendedGoal, session.recommendedGoal)
  assert.equal(compact.exercisePlans, undefined)
  assert.equal(compact.hintStates, undefined)
  assert.ok(JSON.stringify(compact).length < original.length)
  assert.deepEqual(compactFinishedReviewRecord(compact), compact)
  assert.deepEqual(
    [...collectPendingAcquisitionStates({ records: [session], wordRecords: [], wordStates: [] })],
    [...collectPendingAcquisitionStates({ records: [compact], wordRecords: [], wordStates: [] })],
    'completed-session compaction must not lose pending acquisition evidence',
  )
  const unfinished = { ...session, isFinished: false }
  assert.equal(compactFinishedReviewRecord(unfinished), unfinished)
})

test('new cross-device attempt identity uses secure UUID and is not a local autoincrement key', () => {
  const ids = new Set(Array.from({ length: 128 }, () => newLearningAttemptId()))
  assert.equal(ids.size, 128)
  for (const id of ids) assert.ok(isLearningAttemptId(id))
  assert.equal(isLearningAttemptId('1'), false)
  assert.equal(isLearningAttemptId('2026-10-13T08:00:00Z'), false)
  assert.equal(isLearningAttemptId(undefined), false)
  // Compaction must preserve identity without generating a fresh attempt.
  const word = { ...typing(1), attemptId: newLearningAttemptId() }
  const result = compactTypingWordRecord(word)
  assert.equal(result.attemptId, word.attemptId)
  assert.equal(compactTypingWordRecord(result).attemptId, word.attemptId)
})
