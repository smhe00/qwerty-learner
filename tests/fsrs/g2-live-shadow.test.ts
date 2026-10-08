import * as assert from 'node:assert/strict'
import test from 'node:test'
import { buildFsrsLiveShadowObservation } from '../../src/review/fsrs/observation'
import { replayFsrsShadowForWord } from '../../src/review/fsrs/replay'
import { scheduleBasicReview } from '../../src/review/scheduler'
import {
  createInitialReviewWordState,
  type ReviewOutcome,
} from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

const DAY = 86_400
const t0 = Math.floor(
  new Date('2026-09-01T00:00:00.000Z').getTime() / 1000,
)

function eligibleRecord(
  id: number,
  timeStamp: number,
  rating: ReviewOutcome,
): IWordRecord {
  return {
    id,
    word: 'cold',
    timeStamp,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: true,
      rating,
      confidence: 1,
      reasonCodes: ['g2-test'],
    },
  }
}

test('G2 records FSRS analysis beside a Basic-v2 comparator', () => {
  const now = t0 + DAY
  const basicComparator = scheduleBasicReview({
    state: createInitialReviewWordState('cet4', 'cold', t0),
    outcome: 'good',
    now,
  })
  const record = eligibleRecord(101, now, 'good')
  const replay = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records: [record],
    currentState: {
      reviewCount: basicComparator.reviewCount,
    },
  })
  const observation = buildFsrsLiveShadowObservation({
    replay,
    sourceRecordId: 101,
    basicState: basicComparator,
  })

  assert.ok(observation)
  assert.equal(basicComparator.schedulerState.kind, 'basic-v2')
  if (basicComparator.schedulerState.kind !== 'basic-v2') {
    throw new Error('basic-v2 comparator must remain available for analysis')
  }
  assert.equal(observation.rating, 'good')
  assert.equal(observation.libraryVersion, '5.4.2')
  assert.equal(observation.algorithmModel, 'fsrs-6')
  assert.equal(observation.basicV2.dueAt, basicComparator.nextReviewAt)
  assert.equal(
    observation.basicV2.nominalIntervalDays,
    basicComparator.schedulerState.intervalDays,
  )
  assert.equal(
    observation.selectedIntervalDays,
    observation.counterfactual.good.intervalDays,
  )
  assert.deepEqual(
    Object.keys(observation.counterfactual).sort(),
    ['again', 'easy', 'good', 'hard'],
  )
})

test('G2 cannot attach a shadow to a different source record', () => {
  const now = t0 + DAY
  const basicComparator = scheduleBasicReview({
    state: createInitialReviewWordState('cet4', 'cold', t0),
    outcome: 'hard',
    now,
  })
  const replay = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records: [eligibleRecord(201, now, 'hard')],
    currentState: {
      reviewCount: basicComparator.reviewCount,
    },
  })

  assert.equal(
    buildFsrsLiveShadowObservation({
      replay,
      sourceRecordId: 999,
      basicState: basicComparator,
    }),
    undefined,
  )
})
