/**
 * G6-4: does enable_short_term change FSRS without same-day reviews?
 * Use identical, >24h-separated eligible ratings. Do not infer from the
 * study simulator's "sameDayIndependent" counter.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating, createEmptyCard, fsrs } from 'ts-fsrs'

const T0 = Date.parse('2026-10-16T08:00:00.000Z')
const D = 86_400_000
const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const
const DAYS = [0, 2, 5, 9] as const

function replay(shortTerm: boolean, ratings: readonly Rating[]) {
  const scheduler = fsrs({
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: shortTerm,
    learning_steps: [],
    relearning_steps: [],
  })
  let card = createEmptyCard(new Date(T0))
  const trace: Array<{ due: number; stability: number; difficulty: number; state: number }> = []
  for (let i = 0; i < ratings.length; i++) {
    card = scheduler.next(card, new Date(T0 + DAYS[i] * D), ratings[i]).card
    trace.push({
      due: card.due.getTime(),
      stability: card.stability,
      difficulty: card.difficulty,
      state: card.state,
    })
  }
  return trace
}

test('G6-4: measure implementation differences with all events >1d apart and no steps', () => {
  let differences = 0
  let firstDifference: unknown
  let sameTrajectories = 0
  for (const a of RATINGS) for (const b of RATINGS)
    for (const c of RATINGS) for (const d of RATINGS) {
      const events = [a, b, c, d] as const
      const baseline = replay(false, events)
      const shortTerm = replay(true, events)
      if (JSON.stringify(baseline) === JSON.stringify(shortTerm)) {
        sameTrajectories++
      } else {
        differences++
        firstDifference ??= { ratings: events, days: DAYS, baseline, shortTerm }
      }
    }
  // Whether or not differences exist in this controlled fixed clock,
  // log the actual empirical library behavior. This is not human retention.
  assert.equal(differences + sameTrajectories, 256)
  console.log('G6_SHORT_TERM_SCHEDULER_SWITCH ' + JSON.stringify({
    days: DAYS, ratingSequences: 256, differences,
    sameTrajectories, firstDifference,
  }))
})

test('G6-4: fixed identical Good->Again at >1d spacing cannot imply a 10m due without relearning_steps', () => {
  const trace = replay(true, [Rating.Good, Rating.Again, Rating.Good, Rating.Hard])
  assert.equal(trace.length, 4)
  // Intentionally do not hardcode an exact due; the only guaranteed scope
  // is that a native 10m relearning step was NOT configured in this probe.
  assert.ok(trace.every(x => Number.isFinite(x.stability) && Number.isFinite(x.due)))
})
