import type { TypingErrorClassification } from './classifier'
import { materializeReviewExercisePlan } from './decision'
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

function recordOrder(record: IWordRecord): number {
  return record.id ?? record.timeStamp
}

/**
 * Freezes the newest shadow proposal for each review word at session creation.
 *
 * The returned plans are session data, not a new source of truth. They can be
 * rebuilt from WordRecord.reviewPolicyShadow and are intentionally detached
 * from WordComponent async history loading.
 */
export function buildReviewSessionExercisePlans(
  words: Word[],
  records: IWordRecord[],
): ReviewSessionExercisePlans {
  const wanted = new Set(words.map((word) => word.name))
  const latest = new Map<string, IWordRecord>()

  for (const record of records) {
    if (!wanted.has(record.word) || !record.reviewPolicyShadow) continue

    const prior = latest.get(record.word)
    if (!prior || recordOrder(record) > recordOrder(prior)) {
      latest.set(record.word, record)
    }
  }

  const plans: ReviewSessionExercisePlans = {}
  for (const word of words) {
    const shadow = latest.get(word.name)?.reviewPolicyShadow
    if (shadow) {
      plans[word.name] = materializeReviewExercisePlan(shadow)
    }
  }

  return plans
}
