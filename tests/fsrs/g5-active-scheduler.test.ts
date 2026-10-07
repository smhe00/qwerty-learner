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
