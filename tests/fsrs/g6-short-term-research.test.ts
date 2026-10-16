/**
 * G6 research-only probe: native ts-fsrs@5.4.2 short-term & step behavior.
 *
 * Intentional constraints:
 * - Do not import/modify production storage, sessions or scheduler configuration.
 * - Compare exact FSRS cards under deterministic, explicitly eligible ratings.
 * - A fixed event trace is NOT proof of better learning or equal user effort.
 *
 * Run:
 *   mkdir -p .diagnostic
 *   npx esbuild tests/fsrs/g6-short-term-research.test.ts --bundle --platform=node --target=node20 --format=esm --outfile=.diagnostic/g6-short-term-research.test.mjs
 *   node --test .diagnostic/g6-short-term-research.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating, createEmptyCard, fsrs, type Card } from 'ts-fsrs'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const T0 = Date.parse('2026-10-16T08:00:00.000Z')

type Candidate = {
  name: string
  shortTerm: boolean
  learningSteps: string[]
  relearningSteps: string[]
}
type ResearchEvent = {
  eventId: string
  at: number
  rating: Rating
  eligible: boolean
  role: 'canonical-review' | 'short-term-independent' | 'assisted-training'
}
type CardSnapshot = {
  due: string
  state: number
  learningSteps: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  scheduledDays: number
}
type EventTrace = { eventId: string; role: ResearchEvent['role']; grade: Rating; at: string; card: CardSnapshot }

const CANDIDATES: Candidate[] = [
  { name: 'A-production-baseline', shortTerm: false, learningSteps: [], relearningSteps: [] },
  { name: 'B-short-term-dynamics-only', shortTerm: true, learningSteps: [], relearningSteps: [] },
  { name: 'C-native-relearning-10m', shortTerm: true, learningSteps: [], relearningSteps: ['10m'] },
  { name: 'D-native-learning-and-relearning', shortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] },
]

function snapshot(card: Card): CardSnapshot {
  return {
    due: card.due.toISOString(),
    state: card.state,
    learningSteps: card.learning_steps,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduled_days,
  }
}

function compareCandidate(candidate: Candidate, records: readonly ResearchEvent[]): EventTrace[] {
  const scheduler = fsrs({
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: candidate.shortTerm,
    learning_steps: candidate.learningSteps,
    relearning_steps: candidate.relearningSteps,
  })
  let card = createEmptyCard(new Date(T0))
  const seen = new Set<string>()
  const traces: EventTrace[] = []

  for (const event of records) {
    // This emulates an eligibility *boundary*, not production Rating Gate.
    // "assisted-training" must never be retroactively promoted to FSRS Good.
    if (!event.eligible) continue
    if (seen.has(event.eventId)) continue
    seen.add(event.eventId)

    const now = new Date(event.at)
    assert.ok(Number.isFinite(event.at))
    const next = scheduler.next(card, now, event.rating)
    card = next.card
    assert.ok(Number.isFinite(card.stability), candidate.name)
    assert.ok(Number.isFinite(card.difficulty), candidate.name)
    assert.ok(card.due instanceof Date, candidate.name)
    assert.ok(Number.isFinite(card.due.getTime()), candidate.name)
    assert.ok(card.due.getTime() >= event.at, `${candidate.name}: due cannot precede a replayed rating`)
    traces.push({
      eventId: event.eventId,
      role: event.role,
      grade: event.rating,
      at: now.toISOString(),
      card: snapshot(card),
    })
  }
  return traces
}

const FIRST_GOOD: ResearchEvent = {
  eventId: 'first-good',
  at: T0,
  rating: Rating.Good,
  role: 'canonical-review',
  eligible: true,
}

const RELEARNING_TIMELINE: ResearchEvent[] = [
  FIRST_GOOD,
  {
    eventId: 'hinted-copy',
    at: T0 + MINUTE_MS,
    rating: Rating.Good,
    role: 'assisted-training',
    eligible: false,
  },
  {
    eventId: 'independent-10m',
    at: T0 + 10 * MINUTE_MS,
    rating: Rating.Good,
    role: 'short-term-independent',
    eligible: true,
  },
  {
    eventId: 'long-term-lapse',
    at: T0 + 4 * DAY_MS,
    rating: Rating.Again,
    role: 'canonical-review',
    eligible: true,
  },
  {
    eventId: 'hinted-after-lapse',
    at: T0 + 4 * DAY_MS + MINUTE_MS,
    rating: Rating.Good,
    role: 'assisted-training',
    eligible: false,
  },
  {
    eventId: 'independent-after-10m',
    at: T0 + 4 * DAY_MS + 10 * MINUTE_MS,
    rating: Rating.Good,
    role: 'short-term-independent',
    eligible: true,
  },
  {
    eventId: 'later-cold-probe',
    at: T0 + 8 * DAY_MS,
    rating: Rating.Hard,
    role: 'canonical-review',
    eligible: true,
  },
]

test('G6: four isolated candidate configurations produce finite, deterministic native FSRS cards', () => {
  const matrix: Record<string, EventTrace[]> = {}
  for (const candidate of CANDIDATES) {
    const first = compareCandidate(candidate, RELEARNING_TIMELINE)
    const replayed = compareCandidate(candidate, RELEARNING_TIMELINE)
    assert.deepEqual(first, replayed, `${candidate.name}: replay must be deterministic`)
    assert.equal(first.length, 5, `${candidate.name}: assisted events excluded`)
    matrix[candidate.name] = first
  }

  // Visibility, not a promotion decision: preserve native library output
  // for state/due/D/S investigation in the research report.
  console.log('G6_NATIVE_FSRS_6_MATRIX ' + JSON.stringify(matrix))
})

test('G6: native Learning steps produce a different first step from production no-steps baseline', () => {
  const baseline = compareCandidate(CANDIDATES[0], [FIRST_GOOD])
  const native = compareCandidate(CANDIDATES[3], [FIRST_GOOD])
  assert.equal(baseline.length, 1)
  assert.equal(native.length, 1)
  assert.notEqual(
    baseline[0].card.due,
    native[0].card.due,
    'native Learning should expose a scheduling difference from long-term-only mode',
  )
})

test('G6: ineligible assisted practice and a duplicate source event do not change replayed card state', () => {
  for (const candidate of CANDIDATES) {
    const clean = compareCandidate(candidate, [FIRST_GOOD])
    const noisy = compareCandidate(candidate, [
      FIRST_GOOD,
      {
        eventId: 'assisted',
        at: T0 + MINUTE_MS,
        rating: Rating.Easy,
        role: 'assisted-training',
        eligible: false,
      },
      {
        ...FIRST_GOOD,
        at: T0 + 2 * MINUTE_MS,
        rating: Rating.Again,
      },
    ])
    assert.deepEqual(clean, noisy, candidate.name)
  }
})

test('G6: native Relearning must be inspected separately from a fixed delayed-training timer', () => {
  const lapseAfterReview: ResearchEvent[] = [
    FIRST_GOOD,
    {
      eventId: 'forget',
      at: T0 + 4 * DAY_MS,
      rating: Rating.Again,
      role: 'canonical-review',
      eligible: true,
    },
  ]
  const baseline = compareCandidate(CANDIDATES[0], lapseAfterReview)
  const native = compareCandidate(CANDIDATES[2], lapseAfterReview)
  assert.equal(baseline.length, 2)
  assert.equal(native.length, 2)
  console.log('G6_LAPSE_NATIVE_VS_BASELINE ' + JSON.stringify({
    baseline: baseline[1].card,
    native: native[1].card,
    differsInDue: baseline[1].card.due !== native[1].card.due,
    differsInState: baseline[1].card.state !== native[1].card.state,
  }))
})
