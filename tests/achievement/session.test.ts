import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateSessionMetric,
} from '../../src/achievement/session-evaluator'
import type { AchievementCondition } from '../../src/resources/achievementCulture'
import type {
  IWordRecord,
  WordAttemptRecord,
} from '../../src/utils/db/record'

function condition(
  metric: string,
  target = 1,
  constraints: Record<string, string | number | boolean> = {},
): AchievementCondition {
  return {
    metric,
    operator: 'gte',
    target,
    window: null,
    constraints,
  }
}

function attempt(result: 'wrong' | 'clean'): WordAttemptRecord {
  return {
    startLatencyMs: 100,
    durationMs: 500,
    correctPrefixLength: result === 'clean' ? 5 : 2,
    result,
    ...(result === 'wrong'
      ? { wrongIndex: 2, wrongKey: 'x' }
      : {}),
  }
}

function record(input: {
  id: number
  word?: string
  wrongAttempts?: number
  hinted?: boolean
  independent?: boolean
  sourceMode?: 'typing' | 'learn'
}): IWordRecord {
  const wrongAttempts = input.wrongAttempts ?? 0
  const independent = input.independent ?? true
  return {
    id: input.id,
    word: input.word ?? `word-${input.id}`,
    timeStamp: 1_700_000_000 + input.id,
    dict: 'test',
    chapter: -1,
    timing: [],
    wrongCount: wrongAttempts,
    mistakes: {},
    sourceMode: input.sourceMode ?? 'learn',
    learnItemKind: 'review',
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 100,
      attempts: [
        ...Array.from({ length: wrongAttempts }, () => attempt('wrong')),
        attempt('clean'),
      ],
    },
    learningContext: input.hinted
      ? {
          version: 1,
          reviewHint: {
            version: 1,
            maxLevel: 1,
            coldProbeSurrendered: false,
            advanceCount: 1,
          },
        }
      : { version: 1 },
    reviewEvidence: {
      version: 1,
      memoryGrade: wrongAttempts > 0 ? 'hard' : 'good',
      errorCause: wrongAttempts > 0 ? 'spelling' : 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: independent ? 'independent' : 'assisted',
      reasonCodes: [],
    },
  }
}

test('second-half gain compares equal halves and ignores the odd middle item', () => {
  const records = [
    ...Array.from({ length: 6 }, (_, index) =>
      record({ id: index + 1, wrongAttempts: 1 }),
    ),
    record({ id: 7, wrongAttempts: 1 }),
    ...Array.from({ length: 6 }, (_, index) =>
      record({ id: index + 8 }),
    ),
  ]

  assert.equal(
    evaluateSessionMetric(
      condition('session_second_half_accuracy_gain_pp', 20, {
        minWords: 12,
      }),
      { records },
    ),
    100,
  )
})

test('second-half gain refuses sessions below minWords', () => {
  const records = Array.from({ length: 11 }, (_, index) =>
    record({ id: index + 1 }),
  )

  assert.equal(
    evaluateSessionMetric(
      condition('session_second_half_accuracy_gain_pp', 20, {
        minWords: 12,
      }),
      { records },
    ),
    null,
  )
})

test('three consecutive wrong attempts followed by unaided clean input are a recovery', () => {
  const records = [record({ id: 1, wrongAttempts: 3 })]

  assert.equal(
    evaluateSessionMetric(
      condition('recover_after_consecutive_errors', 3),
      { records },
    ),
    3,
  )
})

test('Hint-assisted clean input cannot claim failure recovery', () => {
  const records = [
    record({ id: 1, wrongAttempts: 4, hinted: true, independent: false }),
  ]

  assert.equal(
    evaluateSessionMetric(
      condition('recover_after_consecutive_errors', 3),
      { records },
    ),
    0,
  )
  assert.equal(
    evaluateSessionMetric(
      condition('same_session_fail_then_independent_recovery', 3),
      { records },
    ),
    0,
  )
})

test('same-word failure count can span repeated occurrences in one session', () => {
  const records = [
    {
      ...record({ id: 1, word: 'alpha', wrongAttempts: 2 }),
      typingTelemetry: {
        telemetryVersion: 2 as const,
        firstKeyLatencyMs: 100,
        attempts: [attempt('wrong'), attempt('wrong')],
      },
    },
    record({ id: 2, word: 'beta' }),
    record({ id: 3, word: 'alpha', wrongAttempts: 2 }),
  ]

  assert.equal(
    evaluateSessionMetric(
      condition('same_session_fail_then_independent_recovery', 4),
      { records },
    ),
    4,
  )
})

test('Typing records do not influence session metrics', () => {
  const records = [
    record({
      id: 1,
      wrongAttempts: 20,
      sourceMode: 'typing',
    }),
    record({ id: 2 }),
  ]

  assert.equal(
    evaluateSessionMetric(
      condition('recover_after_consecutive_errors', 1),
      { records },
    ),
    0,
  )
})
