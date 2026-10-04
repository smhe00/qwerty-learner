import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LONG_TERM_MASTERY_DAYS,
  countLongTermMasteredWords,
  didEnterLongTermMastery,
  isLongTermMastered,
} from '../../src/learn/mastery'
import type { IReviewWordState } from '../../src/review/types'

function state(input: {
  word: string
  dict?: string
  intervalDays?: number
  lifecycle?: 'active' | 'excluded'
  lastOutcome?: 'again' | 'hard' | 'good' | 'easy'
  stability?: number
}): IReviewWordState {
  return {
    dict: input.dict ?? 'test',
    word: input.word,
    createdAt: 1,
    updatedAt: 2,
    lastReviewedAt: 2,
    nextReviewAt: 3,
    reviewCount: 5,
    lapseCount: 0,
    cleanStreak: 4,
    lastOutcome: input.lastOutcome ?? 'good',
    lifecycle: input.lifecycle ?? 'active',
    stateVersion: 4,
    schedulerState:
      input.stability !== undefined
        ? {
            kind: 'fsrs6',
            difficulty: 5,
            stability: input.stability,
          }
        : {
            kind: 'basic-v2',
            stage: 4,
            intervalDays: input.intervalDays ?? LONG_TERM_MASTERY_DAYS,
          },
  }
}

test('basic scheduler reaches long-term mastery at the 30-day horizon', () => {
  assert.equal(
    isLongTermMastered(state({ word: 'alpha', intervalDays: 14 })),
    false,
  )
  assert.equal(
    isLongTermMastered(state({ word: 'alpha', intervalDays: 30 })),
    true,
  )
})

test('a lapse or manual exclusion removes current mastery status', () => {
  assert.equal(
    isLongTermMastered(
      state({ word: 'alpha', intervalDays: 60, lastOutcome: 'again' }),
    ),
    false,
  )
  assert.equal(
    isLongTermMastered(
      state({ word: 'alpha', intervalDays: 60, lifecycle: 'excluded' }),
    ),
    false,
  )
})

test('FSRS uses the same 30-day memory horizon contract', () => {
  assert.equal(
    isLongTermMastered(state({ word: 'alpha', stability: 29.9 })),
    false,
  )
  assert.equal(
    isLongTermMastered(state({ word: 'alpha', stability: 30 })),
    true,
  )
})

test('mastery count is distinct by learned word across dictionaries', () => {
  const states = [
    state({ word: 'alpha', dict: 'a', intervalDays: 30 }),
    state({ word: 'alpha', dict: 'b', intervalDays: 60 }),
    state({ word: 'beta', dict: 'a', intervalDays: 30 }),
    state({ word: 'gamma', dict: 'a', intervalDays: 14 }),
  ]
  assert.equal(countLongTermMasteredWords(states), 2)
})

test('mastery crossing fires only on not-mastered to mastered transition', () => {
  const before = state({ word: 'alpha', intervalDays: 14 })
  const after = state({ word: 'alpha', intervalDays: 30 })
  assert.equal(didEnterLongTermMastery(before, after), true)
  assert.equal(
    didEnterLongTermMastery(
      after,
      state({ word: 'alpha', intervalDays: 60 }),
    ),
    false,
  )
})
