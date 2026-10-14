import assert from 'node:assert/strict'
import test from 'node:test'
import { compactAchievementEvent } from '../../src/achievement/storage-retention'
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

test('sparse achievement ledger preserves idempotency, lineage and unlocks without storing zeros', () => {
  const event = {
    eventId: 'word:42', eventType: 'word_attempt' as const, origin: 'live' as const,
    sourceRecordId: 42, sessionId: 'review:7', occurredAt: 1800000000,
    dict: 'test', word: 'ability',
    metricValues: { a: 0, b: 1, c: -3, d: 0, e: 4.5 },
    unlockedAchievementIds: ['milestone'],
  }
  const before = JSON.stringify(event)
  const compact = compactAchievementEvent(event)
  assert.equal(JSON.stringify(event), before)
  assert.notEqual(compact, event)
  assert.deepEqual(compact.metricValues, { b: 1, c: -3, e: 4.5 })
  assert.equal(compact.eventId, event.eventId)
  assert.equal(compact.sourceRecordId, event.sourceRecordId)
  assert.deepEqual(compact.unlockedAchievementIds, event.unlockedAchievementIds)
  assert.deepEqual(compactAchievementEvent(compact), compact)
  assert.ok(JSON.stringify(compact).length < before.length)
})
