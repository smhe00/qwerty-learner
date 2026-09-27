import { expect, test } from '@playwright/test'
import { classifyTypingError } from '../../src/review/classifier'
import { buildReviewDictionaryDiagnostics, buildReviewWordDiagnostics } from '../../src/review/diagnostics'
import { filterDueReviewCandidates } from '../../src/review/due'
import { summarizeWordHistory } from '../../src/review/features'
import { rankDueReviewCandidates, rankReviewCandidates } from '../../src/review/priority'
import { inferReviewOutcomeFromWordRecord, rebuildBasicStateFromWordRecords } from '../../src/review/rebuild'
import {
  classificationToReviewOutcome,
  inferLegacyReviewOutcome,
  scheduleBasicReview,
} from '../../src/review/scheduler'
import { WordTelemetryCollector, readWordTelemetry } from '../../src/review/telemetry'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'
import {
  MAX_REINFORCEMENT_GAP,
  MIN_REINFORCEMENT_GAP,
  getAdaptiveReinforcementGap,
  getReinforcementGap,
  scheduleReinforcement,
} from '../../src/review/session'

test.describe('review domain', () => {
  test('ranks higher error count first and uses recency as a tie breaker', () => {
    const ranked = rankReviewCandidates([
      { word: 'alpha', errorCount: 2, latestErrorTime: 100 },
      { word: 'beta', errorCount: 5, latestErrorTime: 50 },
      { word: 'gamma', errorCount: 5, latestErrorTime: 200 },
    ])

    expect(ranked.map((item) => item.word)).toEqual(['gamma', 'beta', 'alpha'])
  })

  test('uses a bounded reinforcement gap', () => {
    expect(getReinforcementGap(1)).toBe(5)
    expect(getReinforcementGap(2)).toBe(4)
    expect(getReinforcementGap(3)).toBe(3)
    expect(getReinforcementGap(10)).toBe(3)
    expect(MIN_REINFORCEMENT_GAP).toBe(3)
    expect(MAX_REINFORCEMENT_GAP).toBe(7)
  })

  test('reinserts a failed word after intervening words', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 0, queue[0], 3)

    expect(plan.insertedAt).toBe(4)
    expect(plan.queue.map((item) => item.name)).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f', 'g'])
  })

  test('appends reinforcement near the end of a session', () => {
    const queue = ['a', 'b', 'c'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 2, queue[2], 5)

    expect(plan.insertedAt).toBe(3)
    expect(plan.queue.map((item) => item.name)).toEqual(['a', 'b', 'c', 'c'])
  })

  test('keeps at most one pending reinforcement for the same word', () => {
    const queue = ['a', 'b', 'c', 'a', 'd'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 0, queue[0], 3)

    expect(plan.insertedAt).toBeNull()
    expect(plan.queue).toBe(queue)
  })
})


test.describe('review data model', () => {
  test('collects failed and clean attempts without changing legacy timing semantics', () => {
    const collector = new WordTelemetryCollector()
    collector.resetWord()
    collector.markReady(1000)

    collector.recordKey(1300)
    collector.recordKey(1400)
    collector.recordWrong(1, 1, 'x', 1450)

    collector.startNextAttempt(1800)
    collector.recordKey(2000)
    collector.recordKey(2100)
    collector.recordClean(2, 2150)

    expect(collector.snapshot()).toEqual({
      telemetryVersion: 1,
      firstKeyLatencyMs: 300,
      attempts: [
        {
          startLatencyMs: 300,
          durationMs: 150,
          correctPrefixLength: 1,
          result: 'wrong',
          wrongIndex: 1,
          wrongKey: 'x',
          interKeyIntervalsMs: [100],
        },
        {
          startLatencyMs: 200,
          durationMs: 150,
          correctPrefixLength: 2,
          result: 'clean',
          interKeyIntervalsMs: [100],
        },
      ],
    })
  })

  test('treats legacy WordRecord rows without telemetry as valid legacy data', () => {
    const legacyRecord: IWordRecord = {
      word: 'apple',
      timeStamp: 1,
      dict: 'cet4',
      chapter: 0,
      timing: [100, 120],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
    }

    expect(readWordTelemetry(legacyRecord)).toBeUndefined()
  })

  test('creates a scheduler-neutral initial per-word review state', () => {
    expect(createInitialReviewWordState('cet4', 'apple', 1000)).toEqual({
      dict: 'cet4',
      word: 'apple',
      createdAt: 1000,
      updatedAt: 1000,
      nextReviewAt: 1000,
      reviewCount: 0,
      lapseCount: 0,
      cleanStreak: 0,
      stateVersion: 2,
      schedulerState: {
        kind: 'basic-v1',
        stage: 0,
        intervalDays: 0,
      },
    })
  })
})


test.describe('typing error classification', () => {
  test('classifies a fast adjacent-key single error as motor-like', () => {
    const classification = classifyTypingError({
      word: 'apple',
      wrongCount: 1,
      telemetry: {
        telemetryVersion: 1,
        firstKeyLatencyMs: 180,
        attempts: [
          {
            startLatencyMs: 180,
            durationMs: 300,
            correctPrefixLength: 4,
            result: 'wrong',
            wrongIndex: 4,
            wrongKey: 'r',
            interKeyIntervalsMs: [90, 80, 100, 85],
          },
          {
            startLatencyMs: 120,
            durationMs: 350,
            correctPrefixLength: 5,
            result: 'clean',
            interKeyIntervalsMs: [85, 90, 95, 80],
          },
        ],
      },
    })

    expect(classification.cause).toBe('motor')
    expect(getAdaptiveReinforcementGap(1, classification)).toBe(7)
  })

  test('classifies long retrieval latency with varied failures as recall-like', () => {
    const classification = classifyTypingError({
      word: 'necessary',
      wrongCount: 3,
      telemetry: {
        telemetryVersion: 1,
        firstKeyLatencyMs: 3600,
        attempts: [
          { startLatencyMs: 3600, durationMs: 1000, correctPrefixLength: 1, result: 'wrong', wrongIndex: 1, wrongKey: 'x' },
          { startLatencyMs: 900, durationMs: 1300, correctPrefixLength: 3, result: 'wrong', wrongIndex: 3, wrongKey: 'v' },
          { startLatencyMs: 700, durationMs: 1400, correctPrefixLength: 5, result: 'wrong', wrongIndex: 5, wrongKey: 'b' },
          { startLatencyMs: 600, durationMs: 1600, correctPrefixLength: 9, result: 'clean' },
        ],
      },
    })

    expect(classification.cause).toBe('recall')
    expect(getAdaptiveReinforcementGap(3, classification)).toBe(3)
  })

  test('classifies repeated same-position errors as spelling-like', () => {
    const classification = classifyTypingError({
      word: 'receive',
      wrongCount: 2,
      telemetry: {
        telemetryVersion: 1,
        firstKeyLatencyMs: 450,
        attempts: [
          { startLatencyMs: 450, durationMs: 900, correctPrefixLength: 3, result: 'wrong', wrongIndex: 3, wrongKey: 'i', interKeyIntervalsMs: [180, 190, 800] },
          { startLatencyMs: 300, durationMs: 850, correctPrefixLength: 3, result: 'wrong', wrongIndex: 3, wrongKey: 'i', interKeyIntervalsMs: [160, 180, 760] },
          { startLatencyMs: 250, durationMs: 900, correctPrefixLength: 7, result: 'clean', interKeyIntervalsMs: [170, 180, 200, 190, 180, 170] },
        ],
      },
    })

    expect(classification.cause).toBe('spelling')
    expect(getAdaptiveReinforcementGap(2, classification)).toBe(4)
  })

  test('summarizes repeated historical error positions from legacy and telemetry records', () => {
    const summary = summarizeWordHistory([
      {
        word: 'receive',
        timeStamp: 1,
        dict: 'cet4',
        chapter: 0,
        timing: [100],
        wrongCount: 1,
        mistakes: { 3: ['i'] },
      },
      {
        word: 'receive',
        timeStamp: 2,
        dict: 'cet4',
        chapter: -1,
        timing: [100],
        wrongCount: 1,
        mistakes: { 3: ['i'] },
        telemetryVersion: 1,
        firstKeyLatencyMs: 500,
        attempts: [
          { startLatencyMs: 500, durationMs: 900, correctPrefixLength: 3, result: 'wrong', wrongIndex: 3, wrongKey: 'i' },
          { startLatencyMs: 200, durationMs: 1000, correctPrefixLength: 7, result: 'clean' },
        ],
      },
    ])

    expect(summary.recordCount).toBe(2)
    expect(summary.failureRate).toBe(1)
    expect(summary.dominantWrongIndex).toBe(3)
    expect(summary.dominantWrongIndexRatio).toBe(1)
  })
})


test.describe('typing history evidence', () => {
  test('does not treat a single wrong position as a repeated spelling pattern', async () => {
    const { extractTypingBehaviorFeatures } = await import('../../src/review/features')
    const features = extractTypingBehaviorFeatures('apple', 1, {
      telemetryVersion: 1,
      firstKeyLatencyMs: 200,
      attempts: [
        { startLatencyMs: 200, durationMs: 300, correctPrefixLength: 4, result: 'wrong', wrongIndex: 4, wrongKey: 'r' },
        { startLatencyMs: 150, durationMs: 350, correctPrefixLength: 5, result: 'clean' },
      ],
    })

    expect(features.repeatedWrongPositionRatio).toBe(0)
  })

  test('repeated same-position history strengthens spelling evidence versus diffuse history', () => {
    const baseTelemetry = {
      telemetryVersion: 1 as const,
      firstKeyLatencyMs: 700,
      attempts: [
        { startLatencyMs: 700, durationMs: 900, correctPrefixLength: 3, result: 'wrong' as const, wrongIndex: 3, wrongKey: 'i', interKeyIntervalsMs: [180, 190, 800] },
        { startLatencyMs: 300, durationMs: 850, correctPrefixLength: 3, result: 'wrong' as const, wrongIndex: 3, wrongKey: 'i', interKeyIntervalsMs: [160, 180, 760] },
        { startLatencyMs: 250, durationMs: 900, correctPrefixLength: 7, result: 'clean' as const },
      ],
    }

    const diffuse = classifyTypingError({
      word: 'receive',
      wrongCount: 2,
      telemetry: baseTelemetry,
      history: {
        recordCount: 5,
        failedRecordCount: 3,
        failureRate: 0.6,
        dominantWrongIndexRatio: 0.2,
      },
    })
    const fixed = classifyTypingError({
      word: 'receive',
      wrongCount: 2,
      telemetry: baseTelemetry,
      history: {
        recordCount: 5,
        failedRecordCount: 3,
        failureRate: 0.6,
        dominantWrongIndex: 3,
        dominantWrongIndexRatio: 1,
      },
    })

    expect(fixed.scores.spelling).toBeGreaterThan(diffuse.scores.spelling)
  })
})


test.describe('review scheduler adapter boundary', () => {
  test('maps typing causes to scheduler outcomes without binding to FSRS', () => {
    expect(
      classificationToReviewOutcome({
        cause: 'recall',
        confidence: 0.8,
        scores: { recall: 0.8, spelling: 0.1, motor: 0.1 },
      }),
    ).toBe('again')

    expect(
      classificationToReviewOutcome({
        cause: 'spelling',
        confidence: 0.8,
        scores: { recall: 0.1, spelling: 0.8, motor: 0.1 },
      }),
    ).toBe('hard')

    expect(
      classificationToReviewOutcome({
        cause: 'motor',
        confidence: 0.8,
        scores: { recall: 0.1, spelling: 0.1, motor: 0.8 },
      }),
    ).toBe('good')
  })
})


test.describe('basic cross-session scheduler', () => {
  test('advances through 1/3/7/14/30 day intervals on good outcomes', () => {
    let state = createInitialReviewWordState('cet4', 'apple', 1000)
    const intervals: number[] = []

    let now = 1000
    for (let i = 0; i < 6; i++) {
      state = scheduleBasicReview({ state, outcome: 'good', now })
      if (state.schedulerState.kind !== 'basic-v1') throw new Error('unexpected scheduler')
      intervals.push(state.schedulerState.intervalDays)
      now = state.nextReviewAt
    }

    expect(intervals).toEqual([1, 3, 7, 14, 30, 30])
    expect(state.reviewCount).toBe(6)
    expect(state.cleanStreak).toBe(6)
  })

  test('again resets the interval and increments lapse count', () => {
    let state = createInitialReviewWordState('cet4', 'apple', 1000)
    state = scheduleBasicReview({ state, outcome: 'good', now: 1000 })
    state = scheduleBasicReview({ state, outcome: 'good', now: 2000 })
    state = scheduleBasicReview({ state, outcome: 'again', now: 3000 })

    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    })
    expect(state.lapseCount).toBe(1)
    expect(state.cleanStreak).toBe(0)
    expect(state.lastOutcome).toBe('again')
  })

  test('legacy records map conservatively to scheduler outcomes', () => {
    expect(inferLegacyReviewOutcome(0)).toBe('good')
    expect(inferLegacyReviewOutcome(1)).toBe('hard')
    expect(inferLegacyReviewOutcome(2)).toBe('again')
    expect(inferLegacyReviewOutcome(8)).toBe('again')
  })
})


test.describe('due review selection', () => {
  test('keeps only error candidates whose per-word state is due', () => {
    const candidates = [
      { word: 'apple', errorCount: 3, latestErrorTime: 100 },
      { word: 'banana', errorCount: 2, latestErrorTime: 200 },
      { word: 'orange', errorCount: 1, latestErrorTime: 300 },
    ]

    const dueStates = [
      {
        ...createInitialReviewWordState('cet4', 'banana', 1),
        nextReviewAt: 10,
      },
      {
        ...createInitialReviewWordState('cet4', 'orange', 1),
        nextReviewAt: 20,
      },
    ]

    expect(filterDueReviewCandidates(candidates, dueStates).map((item) => item.word)).toEqual(['banana', 'orange'])
  })
})


test.describe('same-session scheduling safety', () => {
  test('does not advance interval when a clean reinforcement happens before the word is due', () => {
    let state = createInitialReviewWordState('cet4', 'apple', 1000)

    state = scheduleBasicReview({ state, outcome: 'again', now: 1000 })
    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    })

    const originalDue = state.nextReviewAt
    state = scheduleBasicReview({ state, outcome: 'good', now: 1300 })
    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    })
    expect(state.nextReviewAt).toBe(originalDue)

    state = scheduleBasicReview({ state, outcome: 'good', now: state.nextReviewAt })
    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 1,
      intervalDays: 3,
    })
  })

  test('normal immediate word loops do not inflate the spaced interval', () => {
    let state = createInitialReviewWordState('cet4', 'banana', 1000)
    state = scheduleBasicReview({ state, outcome: 'good', now: 1000 })
    state = scheduleBasicReview({ state, outcome: 'good', now: 1010 })
    state = scheduleBasicReview({ state, outcome: 'good', now: 1020 })

    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    })
  })
})


test.describe('review diagnostics', () => {
  test('explains latest evidence without mutating scheduler state', () => {
    const state = {
      ...createInitialReviewWordState('cet4', 'receive', 1000),
      nextReviewAt: 2000,
      reviewCount: 2,
    }
    const records: IWordRecord[] = [
      {
        id: 1,
        word: 'receive',
        timeStamp: 1000,
        dict: 'cet4',
        chapter: 0,
        timing: [100, 120],
        wrongCount: 1,
        mistakes: { 3: ['i'] },
      },
      {
        id: 2,
        word: 'receive',
        timeStamp: 1500,
        dict: 'cet4',
        chapter: -1,
        timing: [160, 180, 760],
        wrongCount: 2,
        mistakes: { 3: ['i', 'i'] },
        telemetryVersion: 1,
        firstKeyLatencyMs: 450,
        attempts: [
          {
            startLatencyMs: 450,
            durationMs: 900,
            correctPrefixLength: 3,
            result: 'wrong',
            wrongIndex: 3,
            wrongKey: 'i',
            interKeyIntervalsMs: [160, 180, 760],
          },
          {
            startLatencyMs: 300,
            durationMs: 850,
            correctPrefixLength: 3,
            result: 'wrong',
            wrongIndex: 3,
            wrongKey: 'i',
            interKeyIntervalsMs: [170, 190, 740],
          },
          {
            startLatencyMs: 250,
            durationMs: 900,
            correctPrefixLength: 7,
            result: 'clean',
          },
        ],
      },
    ]

    const diagnostic = buildReviewWordDiagnostics({
      dict: 'cet4',
      word: 'receive',
      now: 1600,
      records,
      state,
    })

    expect(diagnostic.due).toBe(false)
    expect(diagnostic.secondsUntilDue).toBe(400)
    expect(diagnostic.latestRecord?.telemetryAvailable).toBe(true)
    expect(diagnostic.latestFeatures?.repeatedWrongPositionRatio).toBe(1)
    expect(diagnostic.latestClassification).toBeDefined()
    expect(diagnostic.evidenceTags).toContain('repeated-same-position')
    expect(diagnostic.state).toEqual(state)
  })

  test('reports a due state deterministically from supplied time', () => {
    const state = {
      ...createInitialReviewWordState('cet4', 'apple', 1000),
      nextReviewAt: 1500,
    }

    const diagnostic = buildReviewWordDiagnostics({
      dict: 'cet4',
      word: 'apple',
      now: 1500,
      records: [],
      state,
    })

    expect(diagnostic.due).toBe(true)
    expect(diagnostic.secondsUntilDue).toBe(0)
    expect(diagnostic.latestRecord).toBeUndefined()
    expect(diagnostic.evidenceTags).toEqual([])
  })
})


test.describe('review dictionary diagnostics', () => {
  test('summarizes telemetry coverage, causes, due count and scheduler stages', () => {
    const records: IWordRecord[] = [
      {
        id: 1,
        word: 'apple',
        timeStamp: 1000,
        dict: 'cet4',
        chapter: 0,
        timing: [90, 100],
        wrongCount: 0,
        mistakes: {},
        telemetryVersion: 1,
        firstKeyLatencyMs: 180,
        attempts: [
          {
            startLatencyMs: 180,
            durationMs: 400,
            correctPrefixLength: 5,
            result: 'clean',
            interKeyIntervalsMs: [90, 100, 95, 85],
          },
        ],
      },
      {
        id: 2,
        word: 'receive',
        timeStamp: 1100,
        dict: 'cet4',
        chapter: 0,
        timing: [180, 200],
        wrongCount: 2,
        mistakes: { 3: ['i', 'i'] },
      },
    ]

    const states = [
      {
        ...createInitialReviewWordState('cet4', 'apple', 1000),
        nextReviewAt: 900,
        schedulerState: { kind: 'basic-v1' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'receive', 1000),
        nextReviewAt: 3000,
        schedulerState: { kind: 'basic-v1' as const, stage: 0, intervalDays: 1 },
      },
    ]

    const diagnostic = buildReviewDictionaryDiagnostics({
      dict: 'cet4',
      now: 1200,
      records,
      states,
    })

    expect(diagnostic.wordRecordCount).toBe(2)
    expect(diagnostic.uniqueWordCount).toBe(2)
    expect(diagnostic.telemetryRecordCount).toBe(1)
    expect(diagnostic.telemetryCoverage).toBe(0.5)
    expect(diagnostic.stateCount).toBe(2)
    expect(diagnostic.dueCount).toBe(1)
    expect(diagnostic.basicStageCounts).toEqual({ 0: 1, 1: 1 })
    expect(Object.values(diagnostic.causeCounts).reduce((sum, count) => sum + count, 0)).toBe(2)
  })
})


test.describe('review state rebuild fidelity', () => {
  test('uses adaptive telemetry for new records but conservative mapping for legacy rows', () => {
    const legacy: IWordRecord = {
      word: 'apple',
      timeStamp: 1000,
      dict: 'cet4',
      chapter: 0,
      timing: [100],
      wrongCount: 1,
      mistakes: { 4: ['r'] },
    }

    const motorLike: IWordRecord = {
      id: 2,
      word: 'apple',
      timeStamp: 2000,
      dict: 'cet4',
      chapter: -1,
      timing: [90, 80, 100, 85],
      wrongCount: 1,
      mistakes: { 4: ['r'] },
      telemetryVersion: 1,
      firstKeyLatencyMs: 180,
      attempts: [
        {
          startLatencyMs: 180,
          durationMs: 300,
          correctPrefixLength: 4,
          result: 'wrong',
          wrongIndex: 4,
          wrongKey: 'r',
          interKeyIntervalsMs: [90, 80, 100, 85],
        },
        {
          startLatencyMs: 120,
          durationMs: 350,
          correctPrefixLength: 5,
          result: 'clean',
          interKeyIntervalsMs: [85, 90, 95, 80],
        },
      ],
    }

    expect(inferReviewOutcomeFromWordRecord(legacy, [])).toBe('hard')
    expect(inferReviewOutcomeFromWordRecord(motorLike, [legacy])).toBe('good')
  })

  test('rebuilds deterministic basic state from mixed legacy and telemetry records', () => {
    const day = 24 * 60 * 60
    const records: IWordRecord[] = [
      {
        id: 1,
        word: 'apple',
        timeStamp: 1000,
        dict: 'cet4',
        chapter: 0,
        timing: [100],
        wrongCount: 2,
        mistakes: { 1: ['x'], 3: ['v'] },
      },
      {
        id: 2,
        word: 'apple',
        timeStamp: 1000 + day,
        dict: 'cet4',
        chapter: -1,
        timing: [90, 80, 100, 85],
        wrongCount: 1,
        mistakes: { 4: ['r'] },
        telemetryVersion: 1,
        firstKeyLatencyMs: 180,
        attempts: [
          {
            startLatencyMs: 180,
            durationMs: 300,
            correctPrefixLength: 4,
            result: 'wrong',
            wrongIndex: 4,
            wrongKey: 'r',
            interKeyIntervalsMs: [90, 80, 100, 85],
          },
          {
            startLatencyMs: 120,
            durationMs: 350,
            correctPrefixLength: 5,
            result: 'clean',
          },
        ],
      },
    ]

    const rebuilt = rebuildBasicStateFromWordRecords('cet4', 'apple', records)

    expect(rebuilt?.reviewCount).toBe(2)
    expect(rebuilt?.lapseCount).toBe(1)
    expect(rebuilt?.lastOutcome).toBe('good')
    expect(rebuilt?.schedulerState.kind).toBe('basic-v1')
  })
})


test.describe('same-session long-term counters', () => {
  test('does not inflate review counters on immediate reinforcement', () => {
    let state = createInitialReviewWordState('cet4', 'apple', 1000)
    state = scheduleBasicReview({ state, outcome: 'again', now: 1000 })

    expect(state.reviewCount).toBe(1)
    expect(state.lapseCount).toBe(1)
    expect(state.cleanStreak).toBe(0)

    const due = state.nextReviewAt
    state = scheduleBasicReview({ state, outcome: 'good', now: 1300 })
    state = scheduleBasicReview({ state, outcome: 'good', now: 1600 })

    expect(state.reviewCount).toBe(1)
    expect(state.lapseCount).toBe(1)
    expect(state.cleanStreak).toBe(0)
    expect(state.nextReviewAt).toBe(due)
  })

  test('an early failure outside the learning window resets long-term scheduling', () => {
    const day = 24 * 60 * 60
    let state = createInitialReviewWordState('cet4', 'apple', 1000)
    state = scheduleBasicReview({ state, outcome: 'good', now: 1000 })

    const originalDue = state.nextReviewAt
    const laterButStillEarly = 1000 + 2 * 60 * 60
    expect(laterButStillEarly).toBeLessThan(originalDue)

    state = scheduleBasicReview({ state, outcome: 'again', now: laterButStillEarly })

    expect(state.reviewCount).toBe(2)
    expect(state.lapseCount).toBe(1)
    expect(state.schedulerState).toEqual({
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    })
    expect(state.nextReviewAt).toBe(laterButStillEarly + day)
  })
})


test.describe('scheduler-aware review priority', () => {
  test('prioritizes lapse history, weak stage, error count, then overdue time', () => {
    const candidates = [
      { word: 'alpha', errorCount: 10, latestErrorTime: 400 },
      { word: 'beta', errorCount: 2, latestErrorTime: 300 },
      { word: 'gamma', errorCount: 5, latestErrorTime: 200 },
      { word: 'delta', errorCount: 8, latestErrorTime: 100 },
    ]

    const states = [
      {
        ...createInitialReviewWordState('cet4', 'alpha', 1),
        nextReviewAt: 10,
        lapseCount: 0,
        schedulerState: { kind: 'basic-v1' as const, stage: 3, intervalDays: 14 },
      },
      {
        ...createInitialReviewWordState('cet4', 'beta', 1),
        nextReviewAt: 20,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v1' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'gamma', 1),
        nextReviewAt: 30,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v1' as const, stage: 0, intervalDays: 1 },
      },
      {
        ...createInitialReviewWordState('cet4', 'delta', 1),
        nextReviewAt: 40,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v1' as const, stage: 0, intervalDays: 1 },
      },
    ]

    expect(rankDueReviewCandidates(candidates, states).map((item) => item.word)).toEqual([
      'delta',
      'gamma',
      'beta',
      'alpha',
    ])
  })

  test('uses older due time when stronger signals tie', () => {
    const candidates = [
      { word: 'alpha', errorCount: 2, latestErrorTime: 500 },
      { word: 'beta', errorCount: 2, latestErrorTime: 600 },
    ]
    const states = [
      {
        ...createInitialReviewWordState('cet4', 'alpha', 1),
        nextReviewAt: 10,
        lapseCount: 1,
        schedulerState: { kind: 'basic-v1' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'beta', 1),
        nextReviewAt: 20,
        lapseCount: 1,
        schedulerState: { kind: 'basic-v1' as const, stage: 1, intervalDays: 3 },
      },
    ]

    expect(rankDueReviewCandidates(candidates, states).map((item) => item.word)).toEqual(['alpha', 'beta'])
  })
})


test.describe('legacy import scheduler regression', () => {
  test('ignores legacy clean practice when rebuilding an imported historical error word', () => {
    const day = 24 * 60 * 60
    const records: IWordRecord[] = [
      {
        id: 1,
        word: 'receive',
        timeStamp: 1000,
        dict: 'cet4',
        chapter: 0,
        timing: [120, 150],
        wrongCount: 2,
        mistakes: { 3: ['i'], 4: ['e'] },
      },
      {
        id: 2,
        word: 'receive',
        timeStamp: 1000 + 20 * day,
        dict: 'cet4',
        chapter: 0,
        timing: [100, 110],
        wrongCount: 0,
        mistakes: {},
      },
    ]

    expect(inferReviewOutcomeFromWordRecord(records[1], [records[0]])).toBeUndefined()

    const rebuilt = rebuildBasicStateFromWordRecords('cet4', 'receive', records)

    expect(rebuilt).toBeDefined()
    expect(rebuilt?.reviewCount).toBe(1)
    expect(rebuilt?.lapseCount).toBe(1)
    expect(rebuilt?.lastReviewedAt).toBe(1000)
    expect(rebuilt?.nextReviewAt).toBe(1000 + day)
    expect(rebuilt?.stateVersion).toBe(2)
  })

  test('does not create scheduler state from legacy clean-only practice', () => {
    const records: IWordRecord[] = [
      {
        id: 1,
        word: 'apple',
        timeStamp: 1000,
        dict: 'cet4',
        chapter: 0,
        timing: [90, 100],
        wrongCount: 0,
        mistakes: {},
      },
      {
        id: 2,
        word: 'apple',
        timeStamp: 2000,
        dict: 'cet4',
        chapter: 0,
        timing: [80, 90],
        wrongCount: 0,
        mistakes: {},
      },
    ]

    expect(rebuildBasicStateFromWordRecords('cet4', 'apple', records)).toBeUndefined()
  })
})
