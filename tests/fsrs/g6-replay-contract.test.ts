import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating } from 'ts-fsrs'
import {
  G6_PROFILES,
  canonicalG6Events,
  mergeG6Events,
  replayG6Card,
  verifyG6Snapshot,
  type G6Context,
  type G6ResearchEvent,
} from './g6-replay-adapter'

const D = 86_400_000, M = 60_000
const t0 = Date.parse('2026-10-16T08:00:00Z')
const context: G6Context = {
  workspaceId: 'account-A-immutable',
  dict: 'shanghai-zhongkao-2027',
  word: 'necessary',
  seedAtMs: t0,
}
function event(
  id: string,
  minutesAfterSeed: number,
  rating: Rating | null,
  role: G6ResearchEvent['role'] = 'long-term-independent',
): G6ResearchEvent {
  return {
    eventId: id,
    attemptId: 'immutable-' + id,
    workspaceId: context.workspaceId,
    dict: context.dict,
    word: context.word,
    occurredAtMs: t0 + minutesAfterSeed * M,
    role,
    eligible: rating !== null,
    rating,
  }
}
const history = [
  event('day0-good', 0, Rating.Good),
  event('day4-forgot', 4 * 1440, Rating.Again),
  event('day4-hinted', 4 * 1440 + 1, null, 'assisted-training'),
  event('day4-10m-independent', 4 * 1440 + 10, Rating.Good, 'short-term-independent'),
  event('day8-hard', 8 * 1440, Rating.Hard),
]
test('G6-2: all four native FSRS states can be reconstructed exactly from durable research history', () => {
  for (const profile of G6_PROFILES) {
    const original = replayG6Card(context, profile, history)
    const recovered = replayG6Card(context, profile, [...history].reverse())
    assert.deepEqual(recovered.snapshot, original.snapshot, profile.id)
    assert.ok(verifyG6Snapshot(original.snapshot, context, profile, history))
    const serialized = JSON.parse(JSON.stringify(original.snapshot))
    assert.ok(verifyG6Snapshot(serialized, context, profile, history))
    assert.equal(original.snapshot.appliedEventIds.length, 4)
    assert.equal(original.card.reps, 4)
    assert.equal(original.card.lapses, 1)
    assert.ok(Number.isFinite(original.card.due.getTime()))
    // Native FSRS card attributes that the production D/S-only state lacks.
    assert.equal(typeof original.card.learning_steps, 'number')
    assert.equal(typeof original.card.elapsed_days, 'number')
    assert.ok(original.card.last_review instanceof Date)
  }
})

test('G6-2: refresh/resume and re-upload are idempotent, cross-order event union commutes', () => {
  for (const profile of G6_PROFILES) {
    const start = history.slice(0, 3)
    const end = history.slice(3)
    const forward = mergeG6Events(context, start, end)
    const backward = mergeG6Events(context, end, start)
    assert.deepEqual(forward, backward)
    const duplicate = canonicalG6Events(context, [...history, history[0], history[2], history[3]])
    assert.equal(duplicate.length, history.length)
    assert.deepEqual(
      replayG6Card(context, profile, [...forward, history[0]]).snapshot,
      replayG6Card(context, profile, history).snapshot,
    )
  }
})

test('G6-2: conflicting event and attempt IDs are refused, not last-write-wins', () => {
  assert.throws(() =>
    canonicalG6Events(context, [history[0], { ...history[0], rating: Rating.Again }]),
    /conflicting immutable/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [history[0], { ...history[0], eventId: 'renamed' }]),
    /conflicting immutable/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [history[0], { ...history[0], attemptId: 'renamed-attempt' }]),
    /conflicting immutable/,
  )
})

test('G6-2: even ineligible cross-workspace history cannot be mixed into a different account', () => {
  assert.throws(() =>
    canonicalG6Events(context, [
      history[0],
      { ...history[2], workspaceId: 'another-account' },
    ]),
    /cross-workspace/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [
      history[0],
      { ...history[2], dict: 'different-dict' },
    ]),
    /cross-workspace/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [
      history[0],
      { ...history[2], word: 'different-word' },
    ]),
    /cross-workspace/,
  )
})

test('G6-2: rejected overcount from hint-assisted Good, and corrupt/invalid time', () => {
  assert.throws(() =>
    canonicalG6Events(context, [{ ...history[2], eligible: true, rating: Rating.Good }]),
    /assisted work cannot update/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [{ ...history[0], occurredAtMs: t0 - 1000 }]),
    /pre-seed/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [{ ...history[0], occurredAtMs: Number.NaN }]),
    /pre-seed/,
  )
  assert.throws(() =>
    canonicalG6Events(context, [{ ...history[0], eligible: false }]),
    /inconsistent rating/,
  )
})

test('G6-2: missing, modified or injected source records invalidate a saved FSRS snapshot', () => {
  const profile = G6_PROFILES[2]
  const snapshot = replayG6Card(context, profile, history).snapshot
  assert.equal(verifyG6Snapshot(snapshot, context, profile, history.slice(1)), false)
  assert.equal(verifyG6Snapshot(snapshot, context, profile,
    history.map(item => item.eventId === 'day8-hard' ? { ...item, rating: Rating.Easy } : item)), false)
  assert.equal(verifyG6Snapshot(snapshot, context, profile, [...history,
    event('extra-assistance', 30, null, 'assisted-training')]), false)
  assert.equal(verifyG6Snapshot({ ...snapshot, eventsSha256: 'tampered' }, context, profile, history), false)
  assert.equal(verifyG6Snapshot(snapshot, context, G6_PROFILES[1], history), false)
})

test('G6-2: same-timestamp independent events remain deterministic via immutable ID tie-break', () => {
  const at = 15 * 1440
  const a = event('same-time-good', at, Rating.Good)
  const b = event('same-time-hard', at, Rating.Hard)
  const x = replayG6Card(context, G6_PROFILES[2], [a, b]).snapshot
  const y = replayG6Card(context, G6_PROFILES[2], [b, a]).snapshot
  assert.deepEqual(x, y)
  assert.equal(x.appliedEventIds.length, 2)
})

test('G6-2: native Relearning due and card step survive replay even when the session exits', () => {
  const profile = G6_PROFILES[2]
  const justForgot = history.slice(0, 2)
  const saved = replayG6Card(context, profile, justForgot).snapshot
  assert.equal(saved.card.state, 3)
  assert.equal(Date.parse(saved.card.due), t0 + 4 * D + 10 * M)
  // Reopening without an eligible new attempt must not graduate from Relearning.
  const resumed = replayG6Card(context, profile, [...justForgot, history[2]]).snapshot
  assert.equal(resumed.card.state, 3)
  assert.equal(resumed.card.due, saved.card.due)
  assert.equal(resumed.card.reps, saved.card.reps)
})
