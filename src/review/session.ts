import type { TypingErrorClassification } from './classifier'
import type { LearnItemKind } from '@/learn/session'
import type { ReviewAttemptRole } from './state-machine'
import {
  createCanonicalReviewProbePlan,
} from './decision'
import type { ReviewExercisePlanV1 } from './decision'
import type { Word } from '@/typings'
import type { IWordRecord } from '@/utils/db/record'
import { reinforcementGapByCause } from './policy'

export const MIN_REINFORCEMENT_GAP = 3
export const MAX_REINFORCEMENT_GAP = 7

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

export type ReviewSessionExercisePlans = Record<string, ReviewExercisePlanV1>


export function getReviewAttemptRole(input: {
  sessionKind?: LearnItemKind
  reinforcementUsed: number
}): ReviewAttemptRole | undefined {
  if (input.sessionKind !== 'review') return undefined
  return input.reinforcementUsed > 0 ? 'reinforcement' : 'cold'
}

/**
 * Every newly created long-term Review item starts from the same canonical
 * cold probe, independent of the ordinary-learning UI settings or historical
 * adaptive shadows. Remediation/diagnostic shadows may still be generated
 * after the cold probe and applied to a later same-session exercise.
 */
export function buildReviewSessionExercisePlans(
  words: Word[],
  _records: IWordRecord[],
): ReviewSessionExercisePlans {
  return Object.fromEntries(
    words.map((word) => [word.name, createCanonicalReviewProbePlan()]),
  )
}

/**
 * Keep the WordComponent mounted across queue-index changes so its global
 * keyboard listener has no unmounted/remounted gap between words.
 *
 * Per-word attempt state is reset synchronously by the WordComponent word
 * lifecycle. An explicit reloadKey change still remounts the component for
 * same-word loop training.
 */
export function getWordComponentInstanceKey(input: {
  isReviewMode: boolean
  reviewIndex: number
  reloadKey: number
}): string | number {
  return input.reloadKey
}
