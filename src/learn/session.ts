import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  createLearnAcquisitionExercisePlan,
  createLearnAcquisitionState,
} from './acquisition'
import type { LearnAcquisitionState } from './acquisition'
import type { ReviewExercisePlanV1 } from '@/review/decision'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'

export const LEARN_ACQUISITION_POLICY_VERSION =
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION
export const LEARN_NEW_WORD_BATCH_SIZE = 20

export type LearnSessionKind = 'review' | 'acquisition'

/**
 * Learn owns one long-term spelling memory per exact dictionary name.
 *
 * Typing keeps the dictionary list unchanged, including repeated textbook
 * occurrences. Learn collapses repeated names at its boundary so one memory
 * item cannot be expanded into multiple session items. The first occurrence
 * keeps dictionary order while translations are merged for display.
 */
export function canonicalizeLearningWords(words: Word[]): Word[] {
  const canonical: Word[] = []
  const byName = new Map<string, Word>()

  for (const word of words) {
    if (!word?.name) continue

    const existing = byName.get(word.name)
    if (!existing) {
      const copy: Word = {
        ...word,
        trans: [...word.trans],
        ...(word.example !== undefined
          ? { example: word.example.map((example) => ({ ...example })) }
          : {}),
        ...(word.tags !== undefined ? { tags: [...word.tags] } : {}),
      }
      canonical.push(copy)
      byName.set(copy.name, copy)
      continue
    }

    for (const translation of word.trans) {
      if (!existing.trans.includes(translation)) {
        existing.trans.push(translation)
      }
    }

    if (word.example?.length) {
      existing.example ??= []
      for (const example of word.example) {
        const duplicate = existing.example.some(
          (item) =>
            item.en === example.en &&
            item.cn === example.cn &&
            item.start === example.start &&
            item.end === example.end,
        )
        if (!duplicate) existing.example.push({ ...example })
      }
    }

    if (word.tags?.length) {
      existing.tags = [...new Set([...(existing.tags ?? []), ...word.tags])]
    }

    if (!existing.usphone && word.usphone) existing.usphone = word.usphone
    if (!existing.ukphone && word.ukphone) existing.ukphone = word.ukphone
    if (!existing.notation && word.notation) existing.notation = word.notation
  }

  return canonical
}

/**
 * New Learn acquisition starts with a confidence-building visible exposure.
 * The Learn-only controller later swaps this frozen plan to Supported and
 * Independent phases without changing ordinary Typing policy.
 */
export function createLearnAcquisitionPlan(): ReviewExercisePlanV1 {
  return createLearnAcquisitionExercisePlan('exposure')
}

export function buildLearnAcquisitionExercisePlans(
  words: Word[],
): Record<string, ReviewExercisePlanV1> {
  return Object.fromEntries(
    words.map((word) => [word.name, createLearnAcquisitionPlan()]),
  )
}

export function buildLearnAcquisitionStates(
  words: Word[],
): Record<string, LearnAcquisitionState> {
  return Object.fromEntries(
    words.map((word) => [word.name, createLearnAcquisitionState()]),
  )
}

/**
 * Dictionary order is the stable V1 acquisition order. Any existing
 * LearningState means the word has already been admitted or manually
 * excluded, so it is not UNSEEN.
 */
function collectUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
): Word[] {
  const knownWords = new Set(states.map((state) => state.word))
  const selected: Word[] = []
  const selectedNames = new Set<string>()

  for (const word of canonicalizeLearningWords(words)) {
    if (
      knownWords.has(word.name) ||
      selectedNames.has(word.name)
    ) {
      continue
    }

    selected.push(word)
    selectedNames.add(word.name)
  }

  return selected
}

export function selectUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
): Word[] {
  if (limit <= 0) return []
  return collectUnseenLearningWords(words, states).slice(0, limit)
}

export function countUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
): number {
  return collectUnseenLearningWords(words, states).length
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
