import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VOLUNTARY_CONTINUE_WINDOW_SECONDS,
  evaluateVoluntaryContinueAttempt,
} from '../../src/achievement/event-evaluator'

test('continue requires a different session with a real later attempt', () => {
  assert.equal(
    evaluateVoluntaryContinueAttempt({
      intentAt: 100,
      completedSessionId: 'review:1',
      currentSessionId: 'review:2',
      attemptAt: 101,
    }),
    1,
  )

  assert.equal(
    evaluateVoluntaryContinueAttempt({
      intentAt: 100,
      completedSessionId: 'review:1',
      currentSessionId: 'review:1',
      attemptAt: 101,
    }),
    0,
  )

  assert.equal(
    evaluateVoluntaryContinueAttempt({
      intentAt: 100,
      completedSessionId: 'review:1',
      currentSessionId: 'review:2',
      attemptAt: 99,
    }),
    0,
  )
})

test('stale continue intent cannot unlock a future unrelated Learn visit', () => {
  assert.equal(
    evaluateVoluntaryContinueAttempt({
      intentAt: 100,
      completedSessionId: 'review:1',
      currentSessionId: 'review:2',
      attemptAt:
        100 + VOLUNTARY_CONTINUE_WINDOW_SECONDS + 1,
    }),
    0,
  )
})
