import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conditionSatisfied,
  evaluatePreviousWordMetric,
  evaluateWordMetric,
} from '../../src/achievement/evaluator'
import { buildAchievementVisibleProgress } from '../../src/achievement/progress'
import { createInitialReviewWordState } from '../../src/review/types'
import type { AchievementCondition } from '../../src/resources/achievementCulture'
import type { IWordRecord } from '../../src/utils/db/record'

const DAY = 86_400

function condition(
  metric: string,
  target = 1,
  extras: Partial<AchievementCondition> = {},
): AchievementCondition {
  return {
    metric,
    operator: 'gte',
    target,
    window: null,
    constraints: {},
    ...extras,
  }
}

function record(input: {
  id: number
  timeStamp: number
  word?: string
  dict?: string
  wrongCount?: number
  mistakes?: Record<number, string[]>
  sourceMode?: 'typing' | 'learn'
  independent?: boolean
  eligible?: boolean
  rating?: 'again' | 'hard' | 'good' | 'easy'
  hinted?: boolean
}): IWordRecord {
  const independent =
    input.independent ?? (input.wrongCount ?? 0) === 0
  const rating = input.rating ?? (input.wrongCount ? 'again' : 'good')
  return {
    id: input.id,
    word: input.word ?? 'alpha',
    timeStamp: input.timeStamp,
    dict: input.dict ?? 'test',
    chapter: -1,
    timing: [],
    wrongCount: input.wrongCount ?? 0,
    mistakes: input.mistakes ?? {},
    sourceMode: input.sourceMode ?? 'learn',
    learnItemKind: 'review',
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
      memoryGrade: rating,
      errorCause: input.wrongCount ? 'recall' : 'clean',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: independent ? 'independent' : 'assisted',
      reasonCodes: [],
    },
    reviewRatingDecision:
      input.eligible === false
        ? {
            eligible: false,
            rating: null,
            reason: 'training-event',
            reasonCodes: ['training-event'],
          }
        : {
            eligible: true,
            rating,
            confidence: 1,
            reasonCodes: [],
          },
  }
}

test('Typing evidence can never satisfy Learn achievement metrics', () => {
  const current = record({
    id: 1,
    timeStamp: 100,
    sourceMode: 'typing',
    independent: true,
  })
  assert.equal(
    evaluateWordMetric(condition('first_independent_word_correct'), {
      current,
      records: [current],
      now: current.timeStamp,
    }),
    0,
  )
})

test('first independent Learn word and no-hint streak are recognized', () => {
  const records = [
    record({ id: 1, timeStamp: 100 }),
    record({ id: 2, timeStamp: 200 }),
    record({ id: 3, timeStamp: 300 }),
  ]
  const current = records[2]

  assert.equal(
    evaluateWordMetric(condition('first_independent_word_correct'), {
      current,
      records,
      now: current.timeStamp,
    }),
    1,
  )
  assert.equal(
    evaluateWordMetric(
      condition('consecutive_independent_correct_no_hint', 3),
      { current, records, now: current.timeStamp },
    ),
    3,
  )
})

test('error or hint breaks the no-hint streak', () => {
  const records = [
    record({ id: 1, timeStamp: 100 }),
    record({ id: 2, timeStamp: 200, wrongCount: 1 }),
    record({ id: 3, timeStamp: 300 }),
    record({ id: 4, timeStamp: 400 }),
  ]
  assert.equal(
    evaluateWordMetric(
      condition('consecutive_independent_correct_no_hint'),
      { current: records[3], records, now: 400 },
    ),
    2,
  )

  const hinted = record({
    id: 5,
    timeStamp: 500,
    wrongCount: 0,
    independent: false,
    hinted: true,
  })
  records.push(hinted)
  assert.equal(
    evaluateWordMetric(
      condition('consecutive_independent_correct_no_hint'),
      { current: hinted, records, now: 500 },
    ),
    0,
  )
})

test('prior failures and repeated error positions are resolved only by independent success', () => {
  const records = [
    record({
      id: 1,
      timeStamp: 100,
      wrongCount: 1,
      mistakes: { 2: ['x'] },
    }),
    record({
      id: 2,
      timeStamp: 200,
      wrongCount: 1,
      mistakes: { 2: ['y'], 4: ['q'] },
    }),
    record({
      id: 3,
      timeStamp: 300,
      wrongCount: 1,
      mistakes: { 4: ['r'], 6: ['z'] },
    }),
    record({ id: 4, timeStamp: 400, wrongCount: 0 }),
  ]
  const current = records[3]
  const context = { current, records, now: 400 }

  assert.equal(
    evaluateWordMetric(
      condition('prior_failed_word_independent_correct'),
      context,
    ),
    1,
  )
  assert.equal(
    evaluateWordMetric(
      condition('word_independent_correct_after_prior_failures'),
      context,
    ),
    3,
  )
  assert.equal(
    evaluateWordMetric(
      condition('repeated_error_position_resolved', 1, {
        constraints: { samePositionFailuresAtLeast: 2 },
      }),
      context,
    ),
    2,
  )
  assert.equal(
    evaluateWordMetric(
      condition('same_word_distinct_error_positions_resolved'),
      context,
    ),
    3,
  )
})

test('long interval and increasing-interval recall metrics use elapsed time', () => {
  const start = 1_700_000_000
  const records = [
    record({ id: 1, timeStamp: start }),
    record({ id: 2, timeStamp: start + DAY }),
    record({ id: 3, timeStamp: start + 3 * DAY }),
    record({ id: 4, timeStamp: start + 7 * DAY }),
  ]
  const current = records[3]
  const context = { current, records, now: current.timeStamp }

  assert.equal(
    evaluateWordMetric(condition('independent_recall_after_days'), context),
    4,
  )
  assert.equal(
    evaluateWordMetric(
      condition('word_success_across_increasing_intervals'),
      context,
    ),
    3,
  )
})

test('active Learn day window counts local natural days with real attempts', () => {
  const now = Math.floor(new Date('2026-10-04T12:00:00').getTime() / 1000)
  const records = [0, 1, 3, 9, 11].map((daysAgo, index) =>
    record({
      id: index + 1,
      timeStamp: now - daysAgo * DAY,
      word: `w${index}`,
      dict: index % 2 === 0 ? 'test-a' : 'test-b',
    }),
  )
  const current = records[0]
  assert.equal(
    evaluateWordMetric(
      condition('active_learn_days_in_window', 7, { window: '10d' }),
      { current, records, now },
    ),
    4,
  )
})

test('condition operators are deterministic', () => {
  assert.equal(conditionSatisfied({ ...condition('x', 3), operator: 'gte' }, 3), true)
  assert.equal(conditionSatisfied({ ...condition('x', 3), operator: 'gt' }, 3), false)
  assert.equal(conditionSatisfied({ ...condition('x', 3), operator: 'lte' }, 2), true)
  assert.equal(conditionSatisfied({ ...condition('x', 3), operator: 'lt' }, 3), false)
  assert.equal(conditionSatisfied({ ...condition('x', 3), operator: 'eq' }, 3), true)
})


test('audio-only count requires observed absence of text cues and actual pre-input audio', () => {
  const records = Array.from({ length: 10 }, (_, index) => {
    const item = record({
      id: index + 1,
      timeStamp: 1_000 + index,
      word: `audio-${index}`,
    })
    item.exerciseCondition = {
      version: 1,
      purpose: 'probe',
      source: 'adaptive-policy',
      audio: 'automatic',
      meaning: 'hidden',
      phonetic: 'hidden',
      letters: { mode: 'all-hidden' },
      probeDimension: 'audio',
    }
    item.learningContext = {
      version: 1,
      answerVisibilityAtStart: 'hidden',
      exampleVisibleAtStart: false,
      meaningVisibleAtStart: false,
      phoneticVisibleAtStart: false,
      pronunciationEnabledAtStart: true,
      pronunciationPlayed: true,
      pronunciationPlayedBeforeFirstKey: true,
      pronunciationAutomaticPlayCount: 1,
    }
    return item
  })
  const current = records.at(-1)!

  assert.equal(
    evaluateWordMetric(
      condition('audio_only_independent_correct_count', 10),
      { current, records, now: current.timeStamp },
    ),
    10,
  )

  const contaminated = record({
    id: 11,
    timeStamp: 2_000,
    word: 'with-example',
  })
  contaminated.exerciseCondition = records[0].exerciseCondition
  contaminated.learningContext = {
    ...records[0].learningContext,
    exampleVisibleAtStart: true,
  }

  assert.equal(
    evaluateWordMetric(
      condition('audio_only_independent_correct_count', 10),
      {
        current: contaminated,
        records: [...records, contaminated],
        now: contaminated.timeStamp,
      },
    ),
    10,
  )
})

test('Hint reduction compares adjacent windows and enforces attempt/accuracy guards', () => {
  const now = 2_000_000
  const previous = Array.from({ length: 30 }, (_, index) =>
    record({
      id: index + 1,
      timeStamp: now - 13 * DAY + index,
      word: `previous-${index}`,
      hinted: true,
      independent: false,
    }),
  )
  const currentWindow = Array.from({ length: 30 }, (_, index) =>
    record({
      id: index + 31,
      timeStamp: now - 6 * DAY + index,
      word: `current-${index}`,
    }),
  )
  const current = currentWindow.at(-1)!
  const metric = condition(
    'hint_use_rate_drop_pp_vs_previous_window',
    20,
    {
      window: '7d_vs_previous_7d',
      constraints: {
        accuracyDropPpMax: 3,
        minAttemptsEachWindow: 30,
      },
    },
  )

  assert.equal(
    evaluateWordMetric(metric, {
      current,
      records: [...previous, ...currentWindow],
      now,
    }),
    100,
  )

  const previousMixed = Array.from({ length: 30 }, (_, index) =>
    record({
      id: index + 100,
      timeStamp: now - 13 * DAY + index,
      word: `mixed-${index}`,
      hinted: index < 15,
      independent: index >= 15,
    }),
  )
  const degraded = Array.from({ length: 30 }, (_, index) =>
    record({
      id: index + 200,
      timeStamp: now - 6 * DAY + index,
      word: `degraded-${index}`,
      wrongCount: 1,
    }),
  )

  assert.equal(
    evaluateWordMetric(metric, {
      current: degraded.at(-1)!,
      records: [...previousMixed, ...degraded],
      now,
    }),
    null,
  )
})

test('previous metric snapshot supports a strict live threshold-crossing gate', () => {
  const records = Array.from({ length: 11 }, (_, index) =>
    record({
      id: index + 1,
      timeStamp: 10_000 + index,
      word: `streak-${index}`,
    }),
  )
  const metric = condition('consecutive_independent_correct_no_hint', 10)

  assert.equal(
    evaluatePreviousWordMetric(metric, {
      current: records[9],
      records,
      now: records[9].timeStamp,
    }),
    9,
  )
  assert.equal(
    evaluatePreviousWordMetric(metric, {
      current: records[10],
      records,
      now: records[10].timeStamp,
    }),
    10,
  )
})


test('visible achievement progress counts only true long-term mastery and Learn activity', () => {
  const now = Math.floor(
    new Date(2026, 9, 4, 12, 0, 0).getTime() / 1000,
  )
  const mastered = {
    ...createInitialReviewWordState('test', 'mastered', now - 40 * DAY),
    lastOutcome: 'good' as const,
    schedulerState: {
      kind: 'basic-v2' as const,
      stage: 5,
      intervalDays: 30,
    },
  }
  const shortInterval = {
    ...createInitialReviewWordState('test', 'short', now - 5 * DAY),
    lastOutcome: 'good' as const,
    schedulerState: {
      kind: 'basic-v2' as const,
      stage: 2,
      intervalDays: 7,
    },
  }
  const excluded = {
    ...mastered,
    word: 'excluded',
    lifecycle: 'excluded' as const,
    exclusion: {
      reason: 'manual' as const,
      excludedAt: now,
    },
  }

  const wordRecords = [
    record({ id: 500, timeStamp: now, word: 'today' }),
    record({ id: 501, timeStamp: now - DAY, word: 'yesterday' }),
    record({
      id: 502,
      timeStamp: now - 3 * DAY,
      word: 'typing-only',
      sourceMode: 'typing',
    }),
    record({ id: 503, timeStamp: now - 9 * DAY, word: 'edge' }),
    record({ id: 504, timeStamp: now - 10 * DAY, word: 'outside' }),
  ]

  const progress = buildAchievementVisibleProgress({
    wordStates: [mastered, shortInterval, excluded],
    wordRecords,
    now,
  })

  assert.equal(progress.longTermMasteredWords, 1)
  assert.equal(progress.activeLearnDaysInLast10, 3)
})
