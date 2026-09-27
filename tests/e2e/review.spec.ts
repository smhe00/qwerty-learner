import { expect, test } from '@playwright/test'
import { classifyTypingError } from '../../src/review/classifier'
import { summarizeWordHistory } from '../../src/review/features'
import { rankReviewCandidates } from '../../src/review/priority'
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
      stateVersion: 1,
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
