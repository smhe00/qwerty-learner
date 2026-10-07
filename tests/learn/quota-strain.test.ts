import assert from 'node:assert/strict'
import test from 'node:test'
import { createLearnAcquisitionExercisePlan } from '../../src/learn/acquisition'
import { buildLearnDailyPlan } from '../../src/learn/plan'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import { estimateLearnInteractionStrain } from '../../src/learn/strain'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

test('Learn interaction strain ignores Typing and stays unknown until enough Learn evidence exists', () => {
  const learnRecords: IWordRecord[] = Array.from(
    { length: 4 },
    (_, index) => ({
      word: `learn-${index}`,
      timeStamp: index + 1,
      dict: 'strain',
      chapter: -1,
      timing: [],
      wrongCount: 3,
      mistakes: { 0: ['x'] },
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    }),
  )
  const typingRecords: IWordRecord[] = Array.from(
    { length: 10 },
    (_, index) => ({
      word: `typing-${index}`,
      timeStamp: 100 + index,
      dict: 'strain',
      chapter: 0,
      timing: [],
      wrongCount: 10,
      mistakes: { 0: ['x'] },
      sourceMode: 'typing',
    }),
  )

  const estimate = estimateLearnInteractionStrain([
    ...learnRecords,
    ...typingRecords,
  ])

  assert.equal(estimate.tier, 'unknown')
  assert.equal(estimate.score, null)
  assert.equal(estimate.sampleCount, 4)
})

test('Learn interaction strain caps bootstrap new words without touching Typing', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const wordRecords: IWordRecord[] = Array.from(
    { length: 5 },
    (_, index) => ({
      word: `strained-${index}`,
      timeStamp: now - (4 - index) * 30,
      dict: 'strain-quota',
      chapter: -1,
      timing: [],
      wrongCount: 3,
      mistakes: { 0: ['x'], 1: ['y'], 2: ['z'] },
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      learningContext: {
        version: 1,
        reviewHint: {
          version: 1,
          maxLevel: 3,
          coldProbeSurrendered: false,
          advanceCount: 4,
        },
      },
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 9_000,
        attempts: [
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
        ],
      },
    }),
  )

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'strain-quota',
    wordRecords,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.strain.tier, 'recovery')
  assert.ok((stats.strain.score ?? 0) >= 0.55)
  assert.equal(quota.tier, 'low')
  assert.equal(quota.targetDailyNewWords, 5)
  assert.equal(quota.signals.strainTier, 'recovery')
  assert.ok(quota.reasonCodes.includes('interaction-strain-recovery'))
})

test('low interaction strain never increases the memory-based quota', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const wordRecords: IWordRecord[] = Array.from(
    { length: 5 },
    (_, index) => ({
      word: `fluent-${index}`,
      timeStamp: now - (4 - index) * 30,
      dict: 'strain-low',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 500,
        attempts: [
          {
            startLatencyMs: 500,
            durationMs: 1_000,
            correctPrefixLength: 5,
            result: 'clean',
          },
        ],
      },
    }),
  )

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'strain-low',
    wordRecords,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.strain.tier, 'low')
  assert.equal(quota.tier, 'high')
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(
    quota.reasonCodes.includes('interaction-strain-recovery'),
    false,
  )
})

test('Learn P3 keeps the 20-word bootstrap target when review history is insufficient', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: [],
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })

  const quota = decideDailyAcquisitionQuota(stats)
  assert.equal(quota.tier, 'high')
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(quota.allowedNow, 20)
  assert.ok(quota.reasonCodes.includes('bootstrap-insufficient-rated-history'))
})

test('Learn P3 reduces the daily new-word target to 5 under high Again pressure', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `review-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3',
    chapter: -1,
    timing: [],
    wrongCount: index < 4 ? 1 : 0,
    mistakes: index < 4 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision:
      index < 4
        ? {
            eligible: true as const,
            rating: 'again' as const,
            confidence: 1,
            reasonCodes: ['test-again'],
          }
        : {
            eligible: true as const,
            rating: 'good' as const,
            confidence: 1,
            reasonCodes: ['test-good'],
          },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.signals.againRate30d, 40)
  assert.equal(quota.tier, 'low')
  assert.equal(quota.targetDailyNewWords, 5)
  assert.equal(quota.allowedNow, 5)
  assert.ok(quota.reasonCodes.includes('high-again-rate'))
})

test('Learn P3 uses 10 words for moderate review pressure and never exceeds remaining daily quota', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = [
    ...Array.from({ length: 10 }, (_, index) => ({
      word: `review-${index}`,
      timeStamp: now - index * 60,
      dict: 'p3',
      chapter: -1,
      timing: [],
      wrongCount: index < 2 ? 1 : 0,
      mistakes: index < 2 ? { 0: ['x'] } : {},
      sourceMode: 'learn' as const,
      learnItemKind: 'review' as const,
      reviewRatingDecision:
        index < 2
          ? {
              eligible: true as const,
              rating: 'again' as const,
              confidence: 1,
              reasonCodes: ['test-again'],
            }
          : {
              eligible: true as const,
              rating: 'good' as const,
              confidence: 1,
              reasonCodes: ['test-good'],
            },
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      word: `new-${index}`,
      timeStamp: now - index * 30,
      dict: 'p3',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn' as const,
      learnItemKind: 'acquisition' as const,
    })),
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.tier, 'medium')
  assert.equal(quota.targetDailyNewWords, 10)
  assert.equal(quota.remainingDailyNewWords, 3)
  assert.equal(quota.allowedNow, 3)
})

test('Learn P3 keeps Review priority without starving new-word admission', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const dueState = {
    ...createInitialReviewWordState('p3', 'due-word', now),
    nextReviewAt: now - 1,
  }
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: [],
    wordStates: [dueState],
    dictionaryWords: ['due-word', 'new-word'],
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(quota.remainingDailyNewWords, 1)
  assert.equal(quota.allowedNow, 1)
  assert.equal(quota.pausedByDue, false)
  assert.ok(quota.reasonCodes.includes('due-review-priority'))
})


test('Learn P3 can throttle from five valid cold probes before the 30-day sample reaches eight', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 5 }, (_, index) => ({
    word: `cold-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3-cold',
    chapter: -1,
    timing: [],
    wrongCount: index < 3 ? 1 : 0,
    mistakes: index < 3 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision:
      index < 3
        ? {
            eligible: true as const,
            rating: 'again' as const,
            confidence: 1,
            reasonCodes: ['cold-fail'],
          }
        : {
            eligible: true as const,
            rating: 'good' as const,
            confidence: 1,
            reasonCodes: ['cold-pass'],
          },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3-cold',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const decision = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.today.coldProbeAttempts, 5)
  assert.equal(stats.today.coldProbePassRate, 40)
  assert.equal(decision.tier, 'low')
  assert.equal(decision.targetDailyNewWords, 5)
  assert.ok(decision.reasonCodes.includes('low-cold-probe-pass-rate'))
})

test('Learn P3 excludes invalid Rating Gate events from cold-probe quality', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 5 }, (_, index) => ({
    word: `invalid-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3-invalid',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: false as const,
      rating: null,
      reason: 'attention-uncertain' as const,
      reasonCodes: ['attention-uncertain'],
    },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3-invalid',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })
  const decision = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.today.reviewAttempts, 5)
  assert.equal(stats.today.coldProbeAttempts, 0)
  assert.equal(stats.today.coldProbePassRate, null)
  assert.equal(decision.tier, 'high')
  assert.ok(
    decision.reasonCodes.includes('bootstrap-insufficient-rated-history'),
  )
})


test('Learn P4 aggregates phased Acquisition effort per word instead of per attempt', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const phases = ['exposure', 'supported', 'independent'] as const
  const wordRecords: IWordRecord[] = phases.map((phase, index) => {
    const plan = createLearnAcquisitionExercisePlan(phase)
    return {
      word: 'environment',
      timeStamp: now - index * 30,
      dict: 'p4-phased-acquisition',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      exerciseCondition: plan.condition,
      reviewPolicyDecision: plan.decision,
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 2_000,
        attempts: [
          {
            startLatencyMs: 2_000,
            durationMs: 8_000,
            correctPrefixLength: 11,
            result: 'clean',
          },
        ],
      },
    }
  })

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-phased-acquisition',
    wordRecords,
    wordStates: [],
    dictionaryWords: ['environment'],
  })

  assert.equal(stats.effort.todayActiveSeconds, 30)
  assert.equal(stats.effort.medianAcquisitionSeconds, 30)
  assert.equal(stats.effort.recentAcquisitionSamples, 1)
})

test('Learn P4 uses fallback timing for a new user and plans the full 20-word bootstrap', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4',
    wordRecords: [],
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.action, 'acquire-new')
  assert.equal(plan.newWordTarget, 20)
  assert.equal(plan.plannedRemainingNewWords, 20)
  assert.equal(plan.allowedNewWordsNow, 20)
  assert.equal(plan.timeModel.reviewSecondsPerWord, 15)
  assert.equal(plan.timeModel.acquisitionSecondsPerWord, 30)
  assert.equal(plan.estimatedNewMinutes, 10)
})

test('Learn P4 keeps the configured quota after a heavy Review day and reports workload only as advisory', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `review-${index}`,
    timeStamp: now - index * 60,
    dict: 'p4-heavy',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 10_000,
      attempts: [
        {
          startLatencyMs: 10_000,
          durationMs: 80_000,
          correctPrefixLength: 5,
          result: 'clean',
        },
      ],
    },
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['p4-good'],
    },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-heavy',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(stats.effort.todayActiveSeconds, 900)
  assert.equal(stats.effort.medianReviewSeconds, 90)
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(plan.todayActiveMinutes, 15)
  assert.equal(plan.plannedRemainingNewWords, 20)
  assert.equal(plan.allowedNewWordsNow, 20)
  assert.ok(
    plan.reasonCodes.includes('daily-workload-soft-budget-advisory'),
  )
})

test('Learn P4 preserves full Due accounting while reserving bounded room for new acquisition', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const states = Array.from({ length: 50 }, (_, index) => ({
    ...createInitialReviewWordState('p4-due', `due-${index}`, now),
    nextReviewAt: now - 1,
    lastOutcome: index < 8 ? ('hard' as const) : ('good' as const),
  }))
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-due',
    wordRecords: [],
    wordStates: states,
    dictionaryWords: [
      ...states.map((state) => state.word),
      ...Array.from({ length: 50 }, (_, index) => `new-${index}`),
    ],
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.action, 'mixed')
  assert.equal(plan.dueReviewWords, 50)
  assert.equal(plan.difficultDueWords, 8)
  assert.equal(plan.allowedNewWordsNow, 20)
  assert.equal(plan.estimatedDueMinutes, 12.5)
  assert.equal(plan.plannedRemainingNewWords, 20)
  assert.equal(plan.estimatedNewMinutes, 10)
  assert.equal(plan.estimatedRemainingMinutes, 22.5)
  assert.ok(plan.reasonCodes.includes('daily-plan-review-priority'))
})

test('Learn P4 keeps new admission available after the soft workload budget is spent', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `spent-${index}`,
    timeStamp: now - index * 60,
    dict: 'p4-spent',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 20_000,
      attempts: [
        {
          startLatencyMs: 20_000,
          durationMs: 100_000,
          correctPrefixLength: 5,
          result: 'clean',
        },
      ],
    },
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['p4-good'],
    },
  }))
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-spent',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.todayActiveMinutes, 20)
  assert.equal(plan.allowedNewWordsNow, 1)
  assert.equal(plan.action, 'acquire-new')
  assert.ok(
    plan.reasonCodes.includes('daily-workload-soft-budget-advisory'),
  )
})


test('Learn P4 workload includes reinforcement time without promoting it into Review quality metrics', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = [
    {
      word: 'primary',
      timeStamp: now - 60,
      dict: 'p4-reinforcement',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 1000,
        attempts: [
          {
            startLatencyMs: 1000,
            durationMs: 9000,
            correctPrefixLength: 7,
            result: 'clean',
          },
        ],
      },
      reviewRatingDecision: {
        eligible: true,
        rating: 'good',
        confidence: 1,
        reasonCodes: ['primary'],
      },
    },
    {
      word: 'primary',
      timeStamp: now - 30,
      dict: 'p4-reinforcement',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 1000,
        attempts: [
          {
            startLatencyMs: 1000,
            durationMs: 19000,
            correctPrefixLength: 7,
            result: 'clean',
          },
        ],
      },
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'non-cold-attempt',
        reasonCodes: ['reinforcement'],
      },
    },
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-reinforcement',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })

  assert.equal(stats.today.reviewAttempts, 1)
  assert.equal(stats.today.coldProbeAttempts, 1)
  assert.equal(stats.effort.recentReviewSamples, 1)
  assert.equal(stats.effort.medianReviewSeconds, 10)
  assert.equal(stats.effort.todayActiveSeconds, 30)
})
