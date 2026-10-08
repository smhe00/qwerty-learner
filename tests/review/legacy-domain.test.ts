import { expect } from '@playwright/test'
import test from 'node:test'
import { classifyTypingError } from '../../src/review/classifier'
import { buildReviewDictionaryDiagnostics, buildReviewWordDiagnostics } from '../../src/review/diagnostics'
import { filterDueReviewCandidates } from '../../src/review/due'
import { summarizeWordHistory } from '../../src/review/features'
import {
  LearningContextCollector,
  calculateAnswerVisibleRatio,
  readLearningContext,
  summarizeAnswerVisibility,
} from '../../src/review/learning-context'
import { rankDueReviewCandidates, rankReviewCandidates } from '../../src/review/priority'
import { classificationToReviewOutcome } from '../../src/review/scheduler'
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
      telemetryVersion: 2,
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


  test('reads nested optional telemetry', () => {
    const record: IWordRecord = {
      word: 'apple',
      timeStamp: 1,
      dict: 'cet4',
      chapter: 0,
      timing: [100],
      wrongCount: 0,
      mistakes: {},
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 240,
        attempts: [{ startLatencyMs: 240, durationMs: 300, correctPrefixLength: 5, result: 'clean' }],
      },
    }

    expect(readWordTelemetry(record)?.firstKeyLatencyMs).toBe(240)
  })

  test('keeps learning context optional and records semantic assistance events', () => {
    const legacy: IWordRecord = {
      word: 'apple',
      timeStamp: 1,
      dict: 'cet4',
      chapter: 0,
      timing: [],
      wrongCount: 0,
      mistakes: {},
    }
    expect(readLearningContext(legacy)).toBeUndefined()

    const visibility = [false, true, false, true]
    const collector = new LearningContextCollector()
    collector.reset({
      answerVisibilityAtStart: summarizeAnswerVisibility(visibility),
      answerVisibleRatioAtStart: calculateAnswerVisibleRatio(visibility),
      meaningVisibleAtStart: false,
      phoneticVisibleAtStart: true,
      pronunciationEnabledAtStart: true,
    })
    collector.recordAnswerReveal(1000)
    collector.recordMeaningReveal()
    collector.recordPronunciationPlayed('automatic')
    collector.recordInputStarted(1400)
    collector.recordAnswerReveal(1600)
    collector.recordPronunciationPlayed('requested')

    expect(collector.snapshot()).toEqual({
      version: 1,
      answerVisibilityAtStart: 'partial',
      answerVisibleRatioAtStart: 0.5,
      answerRevealed: true,
      revealedBeforeFirstKey: true,
      revealCount: 2,
      lastAnswerRevealToFirstKeyMs: 400,
      meaningVisibleAtStart: false,
      meaningRevealed: true,
      meaningRevealedBeforeFirstKey: true,
      meaningRevealCount: 1,
      phoneticVisibleAtStart: true,
      pronunciationEnabledAtStart: true,
      pronunciationPlayed: true,
      pronunciationPlayedBeforeFirstKey: true,
      pronunciationPlayCount: 2,
      pronunciationAutomaticPlayCount: 1,
      pronunciationRequestedPlayCount: 1,
    })
  })

  test('excludes background pauses from active typing latency', () => {
    const collector = new WordTelemetryCollector()
    collector.resetWord()
    collector.markReady(1000)

    collector.pause(1200)
    collector.resume(31200)
    collector.recordKey(31500)
    collector.recordClean(1, 31600)

    expect(collector.snapshot()).toEqual({
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [
        {
          startLatencyMs: 500,
          durationMs: 100,
          correctPrefixLength: 1,
          result: 'clean',
          interKeyIntervalsMs: [],
        },
      ],
      backgroundPauseMs: 30000,
      backgroundPauseCount: 1,
      backgroundPauseBeforeFirstKeyMs: 30000,
      backgroundPauseBeforeFirstKeyCount: 1,
    })
  })

  test('excludes a background pause from an in-progress attempt', () => {
    const collector = new WordTelemetryCollector()
    collector.resetWord()
    collector.markReady(1000)
    collector.recordKey(1200)

    collector.pause(1300)
    collector.resume(11300)
    collector.recordKey(11500)
    collector.recordClean(2, 11600)

    expect(collector.snapshot()).toEqual({
      telemetryVersion: 2,
      firstKeyLatencyMs: 200,
      attempts: [
        {
          startLatencyMs: 200,
          durationMs: 400,
          correctPrefixLength: 2,
          result: 'clean',
          interKeyIntervalsMs: [300],
        },
      ],
      backgroundPauseMs: 10000,
      backgroundPauseCount: 1,
    })
  })

  test('marks unexplained long foreground idle as attention-uncertain', () => {
    const classification = classifyTypingError({
      word: 'apple',
      wrongCount: 0,
      telemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 20000,
        attempts: [
          {
            startLatencyMs: 20000,
            durationMs: 500,
            correctPrefixLength: 5,
            result: 'clean',
          },
        ],
      },
      learningContext: {
        version: 1,
        answerVisibilityAtStart: 'hidden',
        meaningVisibleAtStart: true,
        pronunciationPlayedBeforeFirstKey: false,
        revealedBeforeFirstKey: false,
        meaningRevealedBeforeFirstKey: false,
      },
    })

    expect(classification.cause).toBe('clean')
    expect(classification.attentionUncertain).toBe(true)
    expect(classificationToReviewOutcome(classification)).toBe('hard')
  })

  test('does not call a long pre-input pause inattentive when the learner actively requested a cue', () => {
    const classification = classifyTypingError({
      word: 'apple',
      wrongCount: 0,
      telemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 20000,
        attempts: [
          {
            startLatencyMs: 20000,
            durationMs: 500,
            correctPrefixLength: 5,
            result: 'clean',
          },
        ],
      },
      learningContext: {
        version: 1,
        pronunciationPlayedBeforeFirstKey: true,
        pronunciationRequestedPlayCount: 1,
      },
    })

    expect(classification.attentionUncertain).toBeUndefined()
    expect(classificationToReviewOutcome(classification)).toBe('good')
  })


})


test.describe('typing error classification', () => {
  test('classifies a fast adjacent-key single error as motor-like', () => {
    const classification = classifyTypingError({
      word: 'apple',
      wrongCount: 1,
      telemetry: {
        telemetryVersion: 2,
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
        telemetryVersion: 2,
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
        telemetryVersion: 2,
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
        typingTelemetry: {
          telemetryVersion: 2,
          firstKeyLatencyMs: 500,
          attempts: [
            { startLatencyMs: 500, durationMs: 900, correctPrefixLength: 3, result: 'wrong', wrongIndex: 3, wrongKey: 'i' },
            { startLatencyMs: 200, durationMs: 1000, correctPrefixLength: 7, result: 'clean' },
          ],
        },
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
      telemetryVersion: 2,
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
      telemetryVersion: 2 as const,
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
        typingTelemetry: {
          telemetryVersion: 2,
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
        typingTelemetry: {
          telemetryVersion: 2,
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
        schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'receive', 1000),
        nextReviewAt: 3000,
        schedulerState: { kind: 'basic-v2' as const, stage: 0, intervalDays: 1 },
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
    expect(diagnostic.attentionUncertainCount).toBe(0)
    expect(diagnostic.basicStageCounts).toEqual({ 0: 1, 1: 1 })
    expect(Object.values(diagnostic.causeCounts).reduce((sum, count) => sum + count, 0)).toBe(2)
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
        schedulerState: { kind: 'basic-v2' as const, stage: 3, intervalDays: 14 },
      },
      {
        ...createInitialReviewWordState('cet4', 'beta', 1),
        nextReviewAt: 20,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'gamma', 1),
        nextReviewAt: 30,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v2' as const, stage: 0, intervalDays: 1 },
      },
      {
        ...createInitialReviewWordState('cet4', 'delta', 1),
        nextReviewAt: 40,
        lapseCount: 2,
        schedulerState: { kind: 'basic-v2' as const, stage: 0, intervalDays: 1 },
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
        schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 3 },
      },
      {
        ...createInitialReviewWordState('cet4', 'beta', 1),
        nextReviewAt: 20,
        lapseCount: 1,
        schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 3 },
      },
    ]

    expect(rankDueReviewCandidates(candidates, states).map((item) => item.word)).toEqual(['alpha', 'beta'])
  })
})


