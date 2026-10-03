import * as assert from 'node:assert/strict'
import test from 'node:test'
import {
  replayFsrsShadowForWord,
  replayFsrsShadowHistory,
  type FsrsReplayRecord,
} from './shadow-replay'

const DAY = 24 * 60 * 60
const t0 = Math.floor(
  new Date('2026-09-01T00:00:00.000Z').getTime() / 1000,
)

function eligible(
  id: number,
  timeStamp: number,
  rating: 'again' | 'hard' | 'good' | 'easy',
): FsrsReplayRecord {
  return {
    id,
    dict: 'cet4',
    word: 'cold',
    timeStamp,
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: true,
      rating,
    },
  }
}

test('G1 replays only eligible Learn Review events', () => {
  const records: FsrsReplayRecord[] = [
    {
      id: 1,
      dict: 'cet4',
      word: 'cold',
      timeStamp: t0,
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    },
    {
      id: 2,
      dict: 'cet4',
      word: 'cold',
      timeStamp: t0 + DAY,
      sourceMode: 'typing',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: true,
        rating: 'easy',
      },
    },
    {
      id: 3,
      dict: 'cet4',
      word: 'cold',
      timeStamp: t0 + 2 * DAY,
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'non-cold-attempt',
      },
    },
    eligible(4, t0 + 3 * DAY, 'good'),
    eligible(5, t0 + 8 * DAY, 'hard'),
  ]

  const result = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records,
    currentState: {
      dict: 'cet4',
      word: 'cold',
      reviewCount: 2,
    },
  })

  assert.equal(result.replayedEligibleEvents, 2)
  assert.equal(result.ignoredEvents, 3)
  assert.equal(result.historyCoverage, 'review-count-matched')
  assert.deepEqual(
    result.events.map((event) => event.sourceRecordId),
    [4, 5],
  )
  assert.deepEqual(
    result.events.map((event) => event.rating),
    ['good', 'hard'],
  )
})

test('G1 replay is deterministic and chronological regardless of input order', () => {
  const records = [
    eligible(3, t0 + 8 * DAY, 'easy'),
    eligible(1, t0 + DAY, 'good'),
    eligible(2, t0 + 3 * DAY, 'again'),
  ]

  const forward = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records,
  })
  const reverse = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records: [...records].reverse(),
  })

  assert.deepEqual(forward, reverse)
  assert.deepEqual(
    forward.events.map((event) => event.sourceRecordId),
    [1, 2, 3],
  )
})

test('G1 records pre-review retrievability and four counterfactual intervals', () => {
  const result = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records: [
      eligible(1, t0 + DAY, 'good'),
      eligible(2, t0 + 10 * DAY, 'good'),
    ],
  })

  assert.equal(result.events[0].retrievabilityBefore, null)
  assert.ok(
    result.events[1].retrievabilityBefore !== null &&
      result.events[1].retrievabilityBefore! >= 0 &&
      result.events[1].retrievabilityBefore! <= 1,
  )

  for (const event of result.events) {
    assert.deepEqual(
      Object.keys(event.counterfactual).sort(),
      ['again', 'easy', 'good', 'hard'],
    )
    assert.equal(
      event.selectedIntervalDays,
      event.counterfactual[event.rating].intervalDays,
    )
  }
})

test('G1 marks incomplete durable history instead of fabricating missing reviews', () => {
  const result = replayFsrsShadowForWord({
    dict: 'cet4',
    word: 'cold',
    records: [
      eligible(10, t0 + DAY, 'good'),
      eligible(11, t0 + 4 * DAY, 'good'),
    ],
    currentState: {
      dict: 'cet4',
      word: 'cold',
      reviewCount: 5,
    },
  })

  assert.equal(result.replayedEligibleEvents, 2)
  assert.equal(result.historyCoverage, 'partial-history')
  assert.equal(result.currentReviewCount, 5)
})

test('G1 batch replay excludes typing-only and invalid-only words', () => {
  const records: FsrsReplayRecord[] = [
    eligible(1, t0 + DAY, 'good'),
    {
      id: 2,
      dict: 'cet4',
      word: 'typing-only',
      timeStamp: t0 + DAY,
      sourceMode: 'typing',
      reviewRatingDecision: {
        eligible: true,
        rating: 'good',
      },
    },
    {
      id: 3,
      dict: 'cet4',
      word: 'invalid-only',
      timeStamp: t0 + DAY,
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'training-event',
      },
    },
    {
      id: 4,
      dict: 'cet4',
      word: 'new-word',
      timeStamp: t0,
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    },
  ]

  const results = replayFsrsShadowHistory({ records })

  assert.deepEqual(
    results.map((result) => result.word).sort(),
    ['cold', 'new-word'],
  )
  assert.equal(
    results.find((result) => result.word === 'new-word')
      ?.replayedEligibleEvents,
    0,
  )
})
