import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLearnCalibrationReport,
  buildTraceSignature,
  compareTraceSignatures,
  splitLearnCalibrationRecordsByTime,
} from '../../src/learn/calibration'
import type { IWordRecord } from '../../src/utils/db/record'

function record(input: {
  id: number
  word: string
  dict: string
  timeStamp: number
  sourceMode: 'typing' | 'learn'
  kind?: 'review' | 'acquisition'
  rating?: 'again' | 'hard' | 'good' | 'easy'
  latency?: number
  hinted?: boolean
}): IWordRecord {
  return {
    id: input.id,
    word: input.word,
    dict: input.dict,
    timeStamp: input.timeStamp,
    chapter: input.sourceMode === 'learn' ? -1 : 0,
    timing: [],
    wrongCount: input.rating === 'again' ? 1 : 0,
    mistakes:
      input.rating === 'again'
        ? { 0: ['PRIVATE_WRONG_KEY'] }
        : {},
    sourceMode: input.sourceMode,
    learnItemKind: input.kind,
    typingTelemetry:
      input.latency === undefined
        ? undefined
        : {
            telemetryVersion: 2,
            firstKeyLatencyMs: input.latency,
            attempts: [],
          },
    learningContext:
      input.hinted === undefined
        ? undefined
        : {
            version: 1,
            ...(input.hinted
              ? {
                  reviewHint: {
                    version: 1,
                    maxLevel: 1,
                    coldProbeSurrendered: false,
                    advanceCount: 1,
                  },
                }
              : {}),
          },
    reviewRatingDecision:
      input.kind === 'review' && input.rating
        ? {
            eligible: true,
            rating: input.rating,
            confidence: 1,
            reasonCodes: ['calibration-test'],
          }
        : undefined,
  }
}

test('calibration report is aggregate-only and excludes raw word, dict and mistake strings', () => {
  const records = [
    record({
      id: 1,
      word: 'PRIVATE_WORD_ALPHA',
      dict: 'PRIVATE_DICT_ALPHA',
      timeStamp: 1_800_000_000,
      sourceMode: 'learn',
      kind: 'review',
      rating: 'good',
      latency: 720,
      hinted: true,
    }),
    record({
      id: 2,
      word: 'PRIVATE_WORD_BETA',
      dict: 'PRIVATE_DICT_BETA',
      timeStamp: 1_800_086_400,
      sourceMode: 'typing',
      latency: 510,
    }),
  ]

  const report = buildLearnCalibrationReport({
    records,
    generatedAt: 1_900_000_000,
  })
  const encoded = JSON.stringify(report)

  assert.equal(report.schemaVersion, 1)
  assert.deepEqual(report.coverage, {
    sourceRecords: 2,
    learnRecords: 1,
    reviewRecords: 1,
    acquisitionRecords: 0,
    telemetryRecords: 1,
    hintObservedRecords: 1,
    ratedReviewRecords: 1,
    fsrsShadowRecords: 0,
  })
  assert.equal(report.signature.medianFirstKeyLatencyMs, 720)
  assert.equal(encoded.includes('PRIVATE_WORD_ALPHA'), false)
  assert.equal(encoded.includes('PRIVATE_WORD_BETA'), false)
  assert.equal(encoded.includes('PRIVATE_DICT_ALPHA'), false)
  assert.equal(encoded.includes('PRIVATE_DICT_BETA'), false)
  assert.equal(encoded.includes('PRIVATE_WRONG_KEY'), false)
})

test('legacy Learn records without telemetry remain missing instead of becoming false zero latency', () => {
  const signature = buildTraceSignature([
    record({
      id: 1,
      word: 'legacy',
      dict: 'legacy-dict',
      timeStamp: 1_800_000_000,
      sourceMode: 'learn',
      kind: 'review',
      rating: 'good',
    }),
  ])

  assert.equal(signature.medianFirstKeyLatencyMs, null)
})

test('temporal calibration split prevents hold-out leakage and ignores Typing records', () => {
  const holdoutStartAt = 1_800_200_000
  const split = splitLearnCalibrationRecordsByTime({
    holdoutStartAt,
    records: [
      record({
        id: 3,
        word: 'holdout',
        dict: 'd',
        timeStamp: holdoutStartAt + 10,
        sourceMode: 'learn',
        kind: 'review',
        rating: 'good',
      }),
      record({
        id: 1,
        word: 'train',
        dict: 'd',
        timeStamp: holdoutStartAt - 10,
        sourceMode: 'learn',
        kind: 'review',
        rating: 'good',
      }),
      record({
        id: 2,
        word: 'typing',
        dict: 'd',
        timeStamp: holdoutStartAt - 5,
        sourceMode: 'typing',
      }),
    ],
  })

  assert.deepEqual(
    split.training.map((item) => item.word),
    ['train'],
  )
  assert.deepEqual(
    split.holdout.map((item) => item.word),
    ['holdout'],
  )
  assert.ok(
    split.training.every(
      (item) => item.timeStamp < holdoutStartAt,
    ),
  )
  assert.ok(
    split.holdout.every(
      (item) => item.timeStamp >= holdoutStartAt,
    ),
  )
})

test('signature comparison reports metric coverage separately from distance', () => {
  const left = buildTraceSignature([
    record({
      id: 1,
      word: 'left',
      dict: 'd',
      timeStamp: 1_800_000_000,
      sourceMode: 'learn',
      kind: 'review',
      rating: 'good',
      latency: 500,
    }),
  ])
  const right = buildTraceSignature([
    record({
      id: 1,
      word: 'right',
      dict: 'd',
      timeStamp: 1_800_000_000,
      sourceMode: 'learn',
      kind: 'review',
      rating: 'again',
      latency: 1000,
    }),
  ])

  const comparison = compareTraceSignatures(left, right)
  assert.ok(comparison.distance > 0)
  assert.ok(comparison.comparableMetrics > 0)
  assert.ok(
    comparison.missingMetrics.includes(
      'reviewSuccessByGap.gt30d',
    ),
  )
  assert.equal(
    comparison.absoluteDeltas.medianFirstKeyLatencyMs,
    500,
  )
})
