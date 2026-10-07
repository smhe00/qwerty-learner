// Pure selector coverage for TASK-20261007-008.
//
// The Learn live strip must expose progress and earned, positive-only
// achievement. Every case here pins one rule that would otherwise silently
// inflate a counter (retries/reinforcement) or leak failure pressure into the
// Learn surface (assisted success, independent failure).

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLearnLiveStats,
  countTodayIntroducedLearnWords,
  deriveLearnLiveStats,
} from '../../src/learn/live-stats'
import type { IReviewRecord, IWordRecord } from '../../src/utils/db/record'
import type { Word } from '../../src/typings'

const SESSION_START = 1_700_000_000

function word(name: string): Word {
  return { name, trans: [`${name}-translation`], usphone: '', ukphone: '' }
}

function queue(...names: string[]): Word[] {
  return names.map(word)
}

function sessionRecord(
  overrides: Partial<IReviewRecord> & { words: Word[] },
): IReviewRecord {
  return {
    id: 4242,
    dict: 'cet4',
    index: 0,
    createTime: SESSION_START,
    isFinished: false,
    sessionKind: 'review',
    ...overrides,
  }
}

function record(
  name: string,
  overrides: Partial<IWordRecord> = {},
): IWordRecord {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    word: name,
    timeStamp: SESSION_START + 60,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: [],
    sourceMode: 'learn',
    ...overrides,
  }
}

function independentClean(name: string, overrides: Partial<IWordRecord> = {}) {
  return record(name, {
    reviewEvidence: {
      version: 1,
      memoryGrade: 'good',
      errorCause: 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'independent',
      reasonCodes: ['independent-clean'],
    },
    ...overrides,
  })
}

test('duplicate physical occurrences count once in 本轮进度', () => {
  // One logical word with a reinforcement occurrence plus a second logical
  // word. Total is logical, and completion is driven by terminal item state.
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'cancel', 'analyse'),
    sessionKind: 'review',
    itemKinds: { cancel: 'review', analyse: 'review' },
    itemStates: {
      cancel: {
        phase: 'done',
        ratingEmitted: true,
        invalidRetryRemaining: 1,
        reinforcementRemaining: 0,
        diagnosticRemaining: 0,
      },
      analyse: {
        phase: 'cold-probe',
        ratingEmitted: false,
        invalidRetryRemaining: 1,
        reinforcementRemaining: 1,
        diagnosticRemaining: 0,
      },
    },
    index: 2,
  })

  const stats = buildLearnLiveStats({
    reviewRecord,
    wordRecords: [],
    elapsedSeconds: 75,
  })

  assert.equal(stats.totalLogicalWords, 2)
  assert.equal(stats.completedLogicalWords, 1)
  assert.equal(stats.elapsedSeconds, 75)
})

test('completed progress never exceeds total', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'analyse'),
    sessionKind: 'review',
    itemStates: {
      cancel: {
        phase: 'done',
        ratingEmitted: true,
        invalidRetryRemaining: 1,
        reinforcementRemaining: 1,
        diagnosticRemaining: 0,
      },
      analyse: {
        phase: 'deferred',
        ratingEmitted: true,
        invalidRetryRemaining: 0,
        reinforcementRemaining: 0,
        diagnosticRemaining: 0,
      },
      // A word that is no longer part of the session must not be counted.
      ghost: {
        phase: 'done',
        ratingEmitted: true,
        invalidRetryRemaining: 1,
        reinforcementRemaining: 1,
        diagnosticRemaining: 0,
      },
    },
    // A stale/oversized queue index must not push completion past the total.
    index: 99,
  })

  const stats = deriveLearnLiveStats({ reviewRecord, wordRecords: [] })

  assert.equal(stats.totalLogicalWords, 2)
  assert.equal(stats.completedLogicalWords, 2)
})

test('review and acquisition are separated for 新学 / 已复习', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'analyse'),
    sessionKind: 'mixed',
    itemKinds: { cancel: 'review', analyse: 'acquisition' },
  })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      record('cancel', { learnItemKind: 'review' }),
      record('cancel', { learnItemKind: 'review', timeStamp: SESSION_START + 120 }),
      record('analyse', { learnItemKind: 'acquisition' }),
      record('analyse', { learnItemKind: 'acquisition', timeStamp: SESSION_START + 180 }),
    ],
  })

  assert.equal(stats.reviewedWords, 1)
  assert.equal(stats.newLearnedWords, 1)
})

test('新学 requires durable acquisition evidence, never queue membership', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'analyse'),
    sessionKind: 'acquisition',
    itemKinds: { cancel: 'acquisition', analyse: 'acquisition' },
  })

  const withoutEvidence = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [],
  })
  assert.equal(withoutEvidence.newLearnedWords, 0)

  const withEvidence = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      record('cancel', { learnItemKind: 'acquisition', chapter: -1 }),
      // Typing rows are never Learn acquisition evidence.
      record('analyse', {
        learnItemKind: 'acquisition',
        sourceMode: 'typing',
        chapter: 0,
      }),
    ],
  })
  assert.equal(withEvidence.newLearnedWords, 1)
})

test('assisted clean attempt does not count as 独立回忆', () => {
  const reviewRecord = sessionRecord({ words: queue('cancel') })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      record('cancel', {
        reviewEvidence: {
          version: 1,
          memoryGrade: 'good',
          errorCause: 'clean',
          confidence: 1,
          evidenceStrength: 1,
          retrievalValidity: 'assisted',
          reasonCodes: ['assisted'],
        },
      }),
    ],
  })

  assert.equal(stats.independentRecallWords, 0)
})

test('independent failure does not count as 独立回忆', () => {
  const reviewRecord = sessionRecord({ words: queue('cancel') })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      independentClean('cancel', {
        reviewEvidence: {
          version: 1,
          memoryGrade: 'again',
          errorCause: 'spelling',
          confidence: 1,
          evidenceStrength: 1,
          retrievalValidity: 'independent',
          reasonCodes: ['independent-but-wrong'],
        },
      }),
    ],
  })

  assert.equal(stats.independentRecallWords, 0)
})

test('independent clean counts exactly once per word', () => {
  const reviewRecord = sessionRecord({ words: queue('cancel') })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [independentClean('cancel')],
  })

  assert.equal(stats.independentRecallWords, 1)
})

test('multiple independent clean records for one word still count once', () => {
  const reviewRecord = sessionRecord({ words: queue('cancel', 'analyse') })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      independentClean('cancel'),
      independentClean('cancel', { timeStamp: SESSION_START + 200 }),
      independentClean('analyse'),
    ],
  })

  assert.equal(stats.independentRecallWords, 2)
})

test('legacy checkpoint without item state falls back to the queue prefix', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'cancel', 'analyse'),
    sessionKind: 'review',
    index: 2,
  })

  const stats = deriveLearnLiveStats({ reviewRecord, wordRecords: [] })

  assert.equal(stats.totalLogicalWords, 2)
  // The consumed prefix holds two physical occurrences of one logical word, so
  // a reinforcement occurrence cannot inflate completion.
  assert.equal(stats.completedLogicalWords, 1)
})

test('legacy fallback clamps a stale index to the queue length', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'analyse'),
    index: 40,
  })

  const stats = deriveLearnLiveStats({ reviewRecord, wordRecords: [] })

  assert.equal(stats.completedLogicalWords, 2)
})

test('acquisition terminal state counts through the acquisition state map', () => {
  const reviewRecord = sessionRecord({
    words: queue('cancel', 'analyse'),
    sessionKind: 'acquisition',
    acquisitionStates: {
      cancel: {
        version: 1,
        phase: 'complete',
        assistedCycles: 0,
      },
      analyse: {
        version: 1,
        phase: 'supported',
        assistedCycles: 1,
      },
    },
  })

  const stats = deriveLearnLiveStats({ reviewRecord, wordRecords: [] })

  assert.equal(stats.completedLogicalWords, 1)
  assert.equal(stats.totalLogicalWords, 2)
})

test('证据 outside the session window or dictionary is ignored', () => {
  const reviewRecord = sessionRecord({ words: queue('cancel') })

  const stats = deriveLearnLiveStats({
    reviewRecord,
    wordRecords: [
      independentClean('cancel', { timeStamp: SESSION_START - 1 }),
      independentClean('cancel', { timeStamp: SESSION_START + 5, dict: 'nce4' }),
      independentClean('cancel', { timeStamp: SESSION_START + 5, sourceMode: 'typing' }),
      independentClean('outside-session', { timeStamp: SESSION_START + 5 }),
    ],
  })

  assert.equal(stats.independentRecallWords, 0)
})

test('an absent session yields an all-zero strip', () => {
  const stats = buildLearnLiveStats({
    reviewRecord: undefined,
    wordRecords: [independentClean('cancel')],
  })

  assert.deepEqual(stats, {
    elapsedSeconds: 0,
    completedLogicalWords: 0,
    totalLogicalWords: 0,
    newLearnedWords: 0,
    reviewedWords: 0,
    independentRecallWords: 0,
  })
})


test('今日新词 counts first introduction only and does not carry yesterday into today', () => {
  const today = SESSION_START + 86_400
  const stats = countTodayIntroducedLearnWords({
    dict: 'cet4',
    now: today + 300,
    wordRecords: [
      record('yesterday', {
        learnItemKind: 'acquisition',
        timeStamp: SESSION_START + 60,
      }),
      record('today', {
        learnItemKind: 'acquisition',
        timeStamp: today + 60,
      }),
      record('today', {
        learnItemKind: 'acquisition',
        timeStamp: today + 120,
      }),
      record('typing-only', {
        learnItemKind: 'acquisition',
        sourceMode: 'typing',
        chapter: 0,
        timeStamp: today + 180,
      }),
    ],
  })

  assert.equal(stats, 1)
})
