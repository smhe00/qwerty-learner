import {
  Rating,
  createEmptyCard,
  fsrs,
} from 'ts-fsrs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const scheduler = fsrs()
const now = new Date('2026-10-03T00:00:00.000Z')
const empty = createEmptyCard(now)

const preview = scheduler.repeat(empty, now)
const ratings = [
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
] as const

for (const rating of ratings) {
  const candidate = preview[rating]
  assert(candidate !== undefined, `missing preview for rating ${rating}`)
  assert(candidate.card !== undefined, `missing card for rating ${rating}`)
  assert(candidate.log !== undefined, `missing log for rating ${rating}`)
}

const next = scheduler.next(empty, now, Rating.Good)
assert(next.card !== undefined, 'next() did not return a card')
assert(next.log !== undefined, 'next() did not return a log')
assert(
  Number.isFinite(next.card.difficulty),
  'FSRS difficulty is not finite after Good',
)
assert(
  Number.isFinite(next.card.stability),
  'FSRS stability is not finite after Good',
)
assert(next.card.due instanceof Date, 'FSRS due is not a Date')

const intervalMs = next.card.due.getTime() - now.getTime()
assert(intervalMs >= 0, 'FSRS scheduled a negative interval')

console.log(
  JSON.stringify(
    {
      ok: true,
      ratingsPreviewed: ratings.length,
      good: {
        due: next.card.due.toISOString(),
        difficulty: next.card.difficulty,
        stability: next.card.stability,
      },
    },
    null,
    2,
  ),
)
