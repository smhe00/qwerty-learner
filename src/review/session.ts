export const MIN_REINFORCEMENT_GAP = 3
export const MAX_REINFORCEMENT_GAP = 7

import type { TypingErrorClassification } from './classifier'
import { reinforcementGapByCause } from './policy'

export type NamedReviewItem = {
  name: string
}

export type ReinforcementPlan<T> = {
  queue: T[]
  insertedAt: number | null
}

/**
 * Harder attempts return sooner, while every returned gap stays inside the
 * 3-7 word reinforcement window.
 */
export function getReinforcementGap(wrongCount: number): number {
  if (wrongCount >= 3) return MIN_REINFORCEMENT_GAP
  if (wrongCount === 2) return 4
  return 5
}

export function clampReinforcementGap(gap: number): number {
  return Math.min(MAX_REINFORCEMENT_GAP, Math.max(MIN_REINFORCEMENT_GAP, gap))
}

/**
 * Schedule at most one pending reinforcement for the same word.
 *
 * The queue is copied only when an insertion is needed. Near the end of a
 * session, the word is appended if there are fewer than the requested number
 * of intervening words.
 */
export function scheduleReinforcement<T extends NamedReviewItem>(
  queue: T[],
  currentIndex: number,
  word: T,
  requestedGap: number,
): ReinforcementPlan<T> {
  const nextIndex = currentIndex + 1
  const alreadyPending = queue.slice(nextIndex).some((item) => item.name === word.name)
  if (alreadyPending) {
    return { queue, insertedAt: null }
  }

  const gap = clampReinforcementGap(requestedGap)
  const insertedAt = Math.min(queue.length, nextIndex + gap)
  const nextQueue = [...queue]
  nextQueue.splice(insertedAt, 0, word)

  return { queue: nextQueue, insertedAt }
}

export function getAdaptiveReinforcementGap(
  wrongCount: number,
  classification?: TypingErrorClassification,
): number {
  if (!classification || classification.cause === 'clean') {
    return getReinforcementGap(wrongCount)
  }

  if (classification.cause === 'recall') return reinforcementGapByCause.recall
  if (classification.cause === 'spelling') return reinforcementGapByCause.spelling
  if (classification.cause === 'motor') return reinforcementGapByCause.motor
  return reinforcementGapByCause.uncertain
}
