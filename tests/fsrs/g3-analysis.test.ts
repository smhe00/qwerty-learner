import * as assert from 'node:assert/strict'
import test from 'node:test'
import {
  G3_DESCRIPTIVE_MIN_SAMPLES,
  G3_G4_REVIEW_MIN_CLASS_SAMPLES,
  G3_G4_REVIEW_MIN_SAMPLES,
  analyzeFsrsShadowRecords,
  type FsrsAnalysisRecordV1,
} from '../../src/review/fsrs/analysis'
import {
  FSRS_SHADOW_ALGORITHM_MODEL,
  FSRS_SHADOW_LIBRARY_VERSION,
  FSRS_SHADOW_PARAMETER_SET_ID,
  FSRS_SHADOW_SCHEMA_VERSION,
} from '../../src/review/fsrs/types'
import type { FsrsLiveShadowObservationV1 } from '../../src/review/fsrs/types'
import type { ReviewOutcome } from '../../src/review/types'

const DAY = 86_400
const t0 = Math.floor(
  new Date('2026-10-01T00:00:00.000Z').getTime() / 1000,
)

function record(input: {
  id: number
  word?: string
  eventTime: number
  rating: ReviewOutcome
  retrievabilityBefore: number | null
  basicIntervalDays: number
  fsrsIntervalDays: number
  basicDueOffsetDays?: number
  fsrsDueOffsetDays?: number
  libraryVersion?: string
}): FsrsAnalysisRecordV1 {
  const word = input.word ?? `word-${input.id}`
  const basicDueAt =
    input.eventTime +
    (input.basicDueOffsetDays ?? input.basicIntervalDays) * DAY
  const fsrsDueAt =
    input.eventTime +
    (input.fsrsDueOffsetDays ?? input.fsrsIntervalDays) * DAY

  const shadow: FsrsLiveShadowObservationV1 = {
    schemaVersion: FSRS_SHADOW_SCHEMA_VERSION,
    libraryVersion:
      (input.libraryVersion ??
        FSRS_SHADOW_LIBRARY_VERSION) as typeof FSRS_SHADOW_LIBRARY_VERSION,
    algorithmModel: FSRS_SHADOW_ALGORITHM_MODEL,
    parameterSetId: FSRS_SHADOW_PARAMETER_SET_ID,
    dict: 'cet4',
    word,
    sourceRecordId: input.id,
    eventTime: input.eventTime,
    rating: input.rating,
    retrievabilityBefore: input.retrievabilityBefore,
    before: {
      dueAt: input.eventTime,
      lastReviewAt: input.eventTime - DAY,
      stability: 3,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      learningSteps: 0,
      state: 2,
    },
    after: {
      dueAt: fsrsDueAt,
      lastReviewAt: input.eventTime,
      stability: 5,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: input.fsrsIntervalDays,
      reps: 2,
      lapses: input.rating === 'again' ? 1 : 0,
      learningSteps: 0,
      state: 2,
    },
    selectedIntervalDays: input.fsrsIntervalDays,
    counterfactual: {
      again: {
        dueAt: input.eventTime + DAY,
        intervalDays: 1,
        stability: 1,
        difficulty: 7,
        state: 3,
      },
      hard: {
        dueAt: input.eventTime + 2 * DAY,
        intervalDays: 2,
        stability: 2,
        difficulty: 6,
        state: 2,
      },
      good: {
        dueAt: input.eventTime + 5 * DAY,
        intervalDays: 5,
        stability: 5,
        difficulty: 5,
        state: 2,
      },
      easy: {
        dueAt: input.eventTime + 10 * DAY,
        intervalDays: 10,
        stability: 10,
        difficulty: 4,
        state: 2,
      },
    },
    historyCoverage: 'review-count-matched',
    replayedEligibleEvents: 2,
    basicV2: {
      dueAt: basicDueAt,
      nominalIntervalDays: input.basicIntervalDays,
      reviewCount: 2,
      lapseCount: input.rating === 'again' ? 1 : 0,
    },
  }

  return {
    id: input.id,
    word,
    dict: 'cet4',
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: true,
      rating: input.rating,

    },
    fsrsShadow: shadow,
  }
}

test('G3 computes calibration and Brier score from pre-review R only', () => {
  const analysis = analyzeFsrsShadowRecords({
    records: [
      record({
        id: 1,
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.9,
        basicIntervalDays: 5,
        fsrsIntervalDays: 6,
      }),
      record({
        id: 2,
        eventTime: t0,
        rating: 'again',
        retrievabilityBefore: 0.2,
        basicIntervalDays: 5,
        fsrsIntervalDays: 1,
      }),
      record({
        id: 3,
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: null,
        basicIntervalDays: 5,
        fsrsIntervalDays: 6,
      }),
    ],
    asOf: t0,
  })

  assert.equal(analysis.calibration.usableSamples, 2)
  assert.equal(analysis.calibration.rememberedSamples, 1)
  assert.equal(analysis.calibration.forgottenSamples, 1)
  assert.equal(analysis.calibration.brierScore, 0.025)
  assert.equal(analysis.readiness, 'collecting')
})

test('G3 discrimination AUC is 1 for perfectly ordered retrievability', () => {
  const analysis = analyzeFsrsShadowRecords({
    records: [
      record({
        id: 10,
        eventTime: t0,
        rating: 'easy',
        retrievabilityBefore: 0.95,
        basicIntervalDays: 5,
        fsrsIntervalDays: 8,
      }),
      record({
        id: 11,
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 5,
        fsrsIntervalDays: 7,
      }),
      record({
        id: 12,
        eventTime: t0,
        rating: 'again',
        retrievabilityBefore: 0.4,
        basicIntervalDays: 5,
        fsrsIntervalDays: 2,
      }),
      record({
        id: 13,
        eventTime: t0,
        rating: 'again',
        retrievabilityBefore: 0.2,
        basicIntervalDays: 5,
        fsrsIntervalDays: 1,
      }),
    ],
    asOf: t0,
  })

  assert.equal(analysis.discrimination.auc, 1)
  assert.equal(
    analysis.discrimination.meanRetrievabilityRemembered,
    0.875,
  )
  assert.equal(
    analysis.discrimination.meanRetrievabilityForgotten,
    0.3,
  )
})

test('G3 captures interval divergence and 4x/quarter outliers', () => {
  const analysis = analyzeFsrsShadowRecords({
    records: [
      record({
        id: 20,
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 10,
        fsrsIntervalDays: 50,
      }),
      record({
        id: 21,
        eventTime: t0,
        rating: 'hard',
        retrievabilityBefore: 0.7,
        basicIntervalDays: 8,
        fsrsIntervalDays: 2,
      }),
      record({
        id: 22,
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.85,
        basicIntervalDays: 10,
        fsrsIntervalDays: 10,
      }),
    ],
    asOf: t0,
  })

  assert.equal(analysis.intervalDivergence.comparableSamples, 3)
  assert.equal(analysis.intervalDivergence.longerThanFourTimesBasic, 1)
  assert.equal(analysis.intervalDivergence.shorterThanQuarterBasic, 1)
  assert.equal(analysis.intervalDivergence.outliers.length, 2)
  assert.equal(analysis.intervalDivergence.ratio.max, 5)
})

test('G3 next-due projection uses only the latest shadow per word', () => {
  const analysis = analyzeFsrsShadowRecords({
    records: [
      record({
        id: 30,
        word: 'same',
        eventTime: t0 - 10 * DAY,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 1,
        fsrsIntervalDays: 1,
      }),
      record({
        id: 31,
        word: 'same',
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 7,
        fsrsIntervalDays: 30,
      }),
      record({
        id: 32,
        word: 'other',
        eventTime: t0,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 1,
        fsrsIntervalDays: 7,
      }),
    ],
    asOf: t0,
  })

  assert.equal(analysis.nextDueProjection.latestShadowWords, 2)
  assert.deepEqual(analysis.nextDueProjection.horizons[0], {
    days: 1,
    basicDueWords: 1,
    fsrsDueWords: 0,
    deltaWords: -1,
  })
  assert.deepEqual(analysis.nextDueProjection.horizons[1], {
    days: 7,
    basicDueWords: 2,
    fsrsDueWords: 1,
    deltaWords: -1,
  })
})

test('G3 rejects mixed package provenance from homogeneous analysis', () => {
  const valid = record({
    id: 40,
    eventTime: t0,
    rating: 'good',
    retrievabilityBefore: 0.8,
    basicIntervalDays: 5,
    fsrsIntervalDays: 6,
  })
  const mixed = record({
    id: 41,
    eventTime: t0,
    rating: 'good',
    retrievabilityBefore: 0.8,
    basicIntervalDays: 5,
    fsrsIntervalDays: 6,
    libraryVersion: '0.0.0-test',
  })

  const analysis = analyzeFsrsShadowRecords({
    records: [valid, mixed],
    asOf: t0,
  })

  assert.equal(analysis.totalShadowRecords, 2)
  assert.equal(analysis.homogeneousShadowRecords, 1)
  assert.equal(analysis.rejectedShadowRecords, 1)
})

test('G3 readiness is descriptive at 50 and G4-review-ready only with balanced evidence', () => {
  const descriptive = Array.from(
    { length: G3_DESCRIPTIVE_MIN_SAMPLES },
    (_, index) =>
      record({
        id: 1000 + index,
        eventTime: t0 + index,
        rating: 'good',
        retrievabilityBefore: 0.8,
        basicIntervalDays: 5,
        fsrsIntervalDays: 6,
      }),
  )

  assert.equal(
    analyzeFsrsShadowRecords({ records: descriptive, asOf: t0 })
      .readiness,
    'descriptive',
  )

  const ready = Array.from(
    { length: G3_G4_REVIEW_MIN_SAMPLES },
    (_, index) =>
      record({
        id: 2000 + index,
        eventTime: t0 + index,
        rating:
          index < G3_G4_REVIEW_MIN_CLASS_SAMPLES ? 'again' : 'good',
        retrievabilityBefore:
          index < G3_G4_REVIEW_MIN_CLASS_SAMPLES ? 0.4 : 0.85,
        basicIntervalDays: 5,
        fsrsIntervalDays: 6,
      }),
  )

  assert.equal(
    analyzeFsrsShadowRecords({ records: ready, asOf: t0 }).readiness,
    'g4-review-ready',
  )
})
