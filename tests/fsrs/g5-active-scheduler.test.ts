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
import { fsrs, Rating, createEmptyCard } from 'ts-fsrs'

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

/**
 * An independent numerical oracle, using ts-fsrs directly rather than
 * importing Qwerty's replay function or mirroring its output. This checks
 * D/S and the exact due timestamp, not merely finiteness/direction.
 *
 * The canonical Good -> ignored/invalid Again -> Hard timeline is the
 * same fixture exercised by the existing persistence check.
 */
test('FSRS-6 review replay preserves exact difficulty, stability and due timestamp', () => {
  const records = [
    acquisition(1),
    review(2, t0 + DAY, 'good'),
    review(3, t0 + 2 * DAY, 'again', false),
    review(4, t0 + 5 * DAY, 'hard'),
  ]
  const actual = rebuildActiveFsrsStateFromWordRecords('test', 'alpha', records)
  assert.ok(actual)
  assert.equal(actual.schedulerState.kind, 'fsrs6')
  if (actual.schedulerState.kind !== 'fsrs6') return

  // Deliberately use the public ts-fsrs library as a second calculator.
  // This avoids using the production replay's computed D/S/Due as the
  // expected values, so a persistence mutation cannot change both.
  const reference = fsrs({
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: [],
  })
  let card = createEmptyCard(new Date(t0 * 1000))
  card = reference.next(card, new Date((t0 + DAY) * 1000), Rating.Good).card
  card = reference.next(card, new Date((t0 + 5 * DAY) * 1000), Rating.Hard).card

  assert.ok(card.difficulty > 0, 'reference difficulty must be meaningful')
  assert.ok(card.stability > 0, 'reference stability must be meaningful')
  assert.ok(Math.abs(actual.schedulerState.difficulty - card.difficulty) < 1e-8,
    'persisted FSRS D must equal independent reference replay')
  assert.ok(Math.abs(actual.schedulerState.stability - card.stability) < 1e-8,
    'persisted FSRS S must equal independent reference replay')
  assert.equal(actual.nextReviewAt, Math.floor(card.due.getTime() / 1000),
    'FSRS Due must equal the reference calendar timestamp, not just be in the future')
  assert.equal(actual.lastReviewedAt, t0 + 5 * DAY)
})
