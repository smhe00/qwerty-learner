import { expect, test } from '@playwright/test'
import { rankReviewCandidates } from '../../src/review/priority'
import {
  MAX_REINFORCEMENT_GAP,
  MIN_REINFORCEMENT_GAP,
  getReinforcementGap,
  scheduleReinforcement,
} from '../../src/review/session'

test.describe('review domain', () => {
  test('ranks higher error count first and uses recency as a tie breaker', () => {
    const ranked = rankReviewCandidates([
      { word: 'alpha', errorCount: 2, latestErrorTime: 100 },
      { word: 'beta', errorCount: 5, latestErrorTime: 50 },
      { word: 'gamma', errorCount: 5, latestErrorTime: 200 },
    ])

    expect(ranked.map((item) => item.word)).toEqual(['gamma', 'beta', 'alpha'])
  })

  test('uses a bounded reinforcement gap', () => {
    expect(getReinforcementGap(1)).toBe(5)
    expect(getReinforcementGap(2)).toBe(4)
    expect(getReinforcementGap(3)).toBe(3)
    expect(getReinforcementGap(10)).toBe(3)
    expect(MIN_REINFORCEMENT_GAP).toBe(3)
    expect(MAX_REINFORCEMENT_GAP).toBe(7)
  })

  test('reinserts a failed word after intervening words', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 0, queue[0], 3)

    expect(plan.insertedAt).toBe(4)
    expect(plan.queue.map((item) => item.name)).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f', 'g'])
  })

  test('appends reinforcement near the end of a session', () => {
    const queue = ['a', 'b', 'c'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 2, queue[2], 5)

    expect(plan.insertedAt).toBe(3)
    expect(plan.queue.map((item) => item.name)).toEqual(['a', 'b', 'c', 'c'])
  })

  test('keeps at most one pending reinforcement for the same word', () => {
    const queue = ['a', 'b', 'c', 'a', 'd'].map((name) => ({ name }))
    const plan = scheduleReinforcement(queue, 0, queue[0], 3)

    expect(plan.insertedAt).toBeNull()
    expect(plan.queue).toBe(queue)
  })
})
