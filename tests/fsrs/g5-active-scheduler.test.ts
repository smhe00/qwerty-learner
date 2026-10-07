import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FSRS6_ACTIVE_STRATEGY,
  FSRS6_DEFAULT_STRATEGY,
} from '../../src/review/fsrs/strategy'
import {
  createInitialFsrsReviewWordState,
  rebuildActiveFsrsStateFromWordRecords,
} from '../../src/review/fsrs/active'
import type { IReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

const DAY = 86_400
const t0 = 1_800_000_000

function acquisition(id: number): IWordRecord {
  return {
    id,
    word: 'alpha',
    dict: 'test',
    chapter: -1,
    timeStamp: t0,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
  }
}

function review(
  id: number,
  at: number,
  rating: 'again' | 'hard' | 'good' | 'easy',
  eligible = true,
): IWordRecord {
  return {
    id,
    word: 'alpha',
    dict: 'test',
    chapter: -1,
    timeStamp: at,
    timing: [],
    wrongCount: rating === 'again' ? 1 : 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: eligible
      ? {
          eligible: true,
          rating,
          confidence: 1,
          reasonCodes: ['g5-active-test'],
        }
      : {
          eligible: false,
          rating: null,
          reason: 'training-event',
          reasonCodes: ['training-event'],
        },
  }
}

test('production FSRS-6 strategy is r0.84 while r0.90 remains the benchmark control', () => {
  assert.equal(FSRS6_ACTIVE_STRATEGY.requestRetention, 0.84)
  assert.equal(FSRS6_DEFAULT_STRATEGY.requestRetention, 0.9)
  assert.notEqual(
    FSRS6_ACTIVE_STRATEGY.id,
    FSRS6_DEFAULT_STRATEGY.id,
  )
})

test('newly admitted words start with FSRS-6 provenance', () => {
  const state = createInitialFsrsReviewWordState(
    'test',
    'alpha',
    t0,
  )
  assert.equal(state.schedulerState.kind, 'fsrs6')
  if (state.schedulerState.kind !== 'fsrs6') return
  assert.equal(
    state.schedulerState.parameterSetId,
    FSRS6_ACTIVE_STRATEGY.id,
  )
  assert.equal(state.reviewCount, 0)
})

test('active FSRS state is rebuilt only from eligible long-term Review ratings', () => {
  const records = [
    acquisition(1),
    review(2, t0 + DAY, 'good'),
    review(3, t0 + 2 * DAY, 'again', false),
    review(4, t0 + 5 * DAY, 'hard'),
  ]

  const state = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    records,
  )
  assert.ok(state)
  assert.equal(state.schedulerState.kind, 'fsrs6')
  if (state.schedulerState.kind !== 'fsrs6') return
  assert.equal(
    state.schedulerState.parameterSetId,
    FSRS6_ACTIVE_STRATEGY.id,
  )
  assert.equal(state.reviewCount, 2)
  assert.equal(state.lapseCount, 0)
  assert.equal(state.lastOutcome, 'hard')
  assert.equal(state.lastReviewedAt, t0 + 5 * DAY)
  assert.ok(state.nextReviewAt > (state.lastReviewedAt ?? 0))
  assert.ok(Number.isFinite(state.schedulerState.difficulty))
  assert.ok(Number.isFinite(state.schedulerState.stability))
})

test('an eligible Again is replayed as a long-term lapse', () => {
  const state = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    [
      acquisition(1),
      review(2, t0 + DAY, 'good'),
      review(3, t0 + 3 * DAY, 'again'),
    ],
  )
  assert.ok(state)
  assert.equal(state.reviewCount, 2)
  assert.equal(state.lapseCount, 1)
  assert.equal(state.cleanStreak, 0)
  assert.equal(state.lastOutcome, 'again')
})


test('opaque legacy state bridges safely until the next eligible Review', () => {
  const legacy: IReviewWordState = {
    dict: 'test',
    word: 'alpha',
    createdAt: t0 - 30 * DAY,
    updatedAt: t0,
    lastReviewedAt: t0,
    nextReviewAt: t0 + 10 * DAY,
    reviewCount: 7,
    lapseCount: 2,
    cleanStreak: 3,
    lastOutcome: 'good',
    lifecycle: 'active',
    stateVersion: 4,
    schedulerState: {
      kind: 'basic-v2',
      stage: 4,
      intervalDays: 30,
    },
  }

  // No post-cutoff eligible Review means migration must not fabricate an
  // FSRS state from incomplete history. Repository migration keeps the
  // durable legacy row as the due/lifecycle authority.
  const beforeNextReview = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    [
      {
        id: 1,
        word: 'alpha',
        dict: 'test',
        chapter: -1,
        timeStamp: t0,
        timing: [],
        wrongCount: 0,
        mistakes: {},
      },
    ],
    { priorState: legacy },
  )
  assert.equal(beforeNextReview, undefined)

  const transitioned = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    [
      {
        id: 1,
        word: 'alpha',
        dict: 'test',
        chapter: -1,
        timeStamp: t0,
        timing: [],
        wrongCount: 0,
        mistakes: {},
      },
      review(2, t0 + DAY, 'hard'),
    ],
    { priorState: legacy },
  )

  assert.ok(transitioned)
  assert.equal(transitioned.reviewCount, 8)
  assert.equal(transitioned.lapseCount, 2)
  assert.equal(transitioned.cleanStreak, 4)
  assert.equal(transitioned.lastOutcome, 'hard')
  assert.equal(transitioned.lastReviewedAt, t0 + DAY)
  assert.equal(transitioned.lifecycle, 'active')
  assert.equal(transitioned.schedulerState.kind, 'fsrs6')
  if (transitioned.schedulerState.kind !== 'fsrs6') return
  assert.equal(
    transitioned.schedulerState.parameterSetId,
    FSRS6_ACTIVE_STRATEGY.id,
  )
  assert.deepEqual(transitioned.schedulerState.legacyBridge, {
    version: 1,
    cutoffAt: t0,
    reviewCountOffset: 7,
    lapseCountOffset: 2,
    cleanStreakOffset: 3,
  })
  assert.ok(transitioned.nextReviewAt > t0 + DAY)
})

test('legacy bridge replay remains deterministic across later active Reviews', () => {
  const legacy: IReviewWordState = {
    dict: 'test',
    word: 'alpha',
    createdAt: t0 - 20 * DAY,
    updatedAt: t0,
    lastReviewedAt: t0,
    nextReviewAt: t0 + DAY,
    reviewCount: 3,
    lapseCount: 1,
    cleanStreak: 2,
    lastOutcome: 'good',
    lifecycle: 'active',
    stateVersion: 5,
    schedulerState: {
      kind: 'basic-v1',
      stage: 0,
      intervalDays: 1,
    },
  }
  const records = [
    review(10, t0 + DAY, 'good'),
    review(11, t0 + 5 * DAY, 'again'),
  ]

  const first = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    records,
    { priorState: legacy },
  )
  assert.ok(first)
  assert.equal(first.reviewCount, 5)
  assert.equal(first.lapseCount, 2)
  assert.equal(first.cleanStreak, 0)

  const replayed = rebuildActiveFsrsStateFromWordRecords(
    'test',
    'alpha',
    records,
    { priorState: first },
  )
  assert.ok(replayed)
  assert.deepEqual(replayed, first)
})
