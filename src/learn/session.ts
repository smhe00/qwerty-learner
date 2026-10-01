import {
  REVIEW_EXERCISE_PLAN_VERSION,
  REVIEW_POLICY_SHADOW_VERSION,
  createReviewPolicyDecision,
} from '@/review/decision'
import type { ReviewExercisePlanV1 } from '@/review/decision'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'

export const LEARN_ACQUISITION_POLICY_VERSION = 'learn-acquisition-v1'
export const LEARN_NEW_WORD_BATCH_SIZE = 20

export type LearnSessionKind = 'review' | 'acquisition'

/**
 * Acquisition is deliberately a training condition, not a memory probe.
 *
 * A new word is shown in full with meaning, phonetic and pronunciation so the
 * learner can establish an initial representation. Completing this exercise
 * admits the word to long-term Learn with an initial due date, but does not
 * fabricate Again/Hard/Good/Easy.
 */
export function createLearnAcquisitionPlan(): ReviewExercisePlanV1 {
  const condition = {
    version: 1 as const,
    purpose: 'training' as const,
    source: 'adaptive-policy' as const,
    audio: 'automatic' as const,
    meaning: 'visible' as const,
    phonetic: 'visible' as const,
    letters: { mode: 'all-visible' as const },
    probeDimension: 'none' as const,
  }

  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition,
    decision: createReviewPolicyDecision(
      LEARN_ACQUISITION_POLICY_VERSION,
      [
        'learn-acquisition',
        'full-orthography-visible',
        'meaning-visible',
        'phonetic-visible',
        'automatic-audio',
        'no-scheduler-rating',
      ],
      condition.version,
    ),
    sourceShadowVersion: REVIEW_POLICY_SHADOW_VERSION,
  }
}

export function buildLearnAcquisitionExercisePlans(
  words: Word[],
): Record<string, ReviewExercisePlanV1> {
  return Object.fromEntries(
    words.map((word) => [word.name, createLearnAcquisitionPlan()]),
  )
}

/**
 * Dictionary order is the stable V1 acquisition order. Any existing
 * LearningState means the word has already been admitted or manually
 * excluded, so it is not UNSEEN.
 */
export function selectUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
): Word[] {
  if (limit <= 0) return []

  const knownWords = new Set(states.map((state) => state.word))
  const selected: Word[] = []
  const selectedNames = new Set<string>()

  for (const word of words) {
    if (
      !word?.name ||
      knownWords.has(word.name) ||
      selectedNames.has(word.name)
    ) {
      continue
    }

    selected.push(word)
    selectedNames.add(word.name)

    if (selected.length >= limit) break
  }

  return selected
}


export type LearnStartKind = 'review' | 'acquisition' | 'empty'

/**
 * Product-level start priority: due review always wins. New acquisition is
 * allowed only when there is no due review work.
 */
export function decideLearnStartKind(input: {
  dueCount: number
  unseenCount: number
}): LearnStartKind {
  if (input.dueCount > 0) return 'review'
  if (input.unseenCount > 0) return 'acquisition'
  return 'empty'
}
