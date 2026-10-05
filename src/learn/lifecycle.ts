import type { IReviewWordState } from '@/review/types'
import type { IReviewRecord } from '@/utils/db/record'

export type LearningLifecycle = 'unseen' | 'active' | 'excluded'

export type LearningLifecycleEvent =
  | { kind: 'typing-observation' }
  | { kind: 'exclude'; now: number }
  | { kind: 'restore'; now: number }

export function getLearningLifecycle(
  state: IReviewWordState | undefined,
): LearningLifecycle {
  if (!state) return 'unseen'
  return state.lifecycle === 'excluded' ? 'excluded' : 'active'
}

export function isActiveLearningState(state: IReviewWordState | undefined) {
  return getLearningLifecycle(state) === 'active'
}

/**
 * Pure lifecycle transition used by UI/repository code and formal tests.
 * Typing observations are explicitly lifecycle-neutral.
 */
export function decideLearningLifecycleTransition(
  state: IReviewWordState,
  event: LearningLifecycleEvent,
): IReviewWordState {
  if (event.kind === 'typing-observation') return state

  if (event.kind === 'exclude') {
    if (getLearningLifecycle(state) === 'excluded') return state

    return {
      ...state,
      lifecycle: 'excluded',
      updatedAt: Math.max(state.updatedAt, event.now),
      exclusion: {
        reason: 'manual',
        excludedAt: event.now,
      },
    }
  }

  if (getLearningLifecycle(state) !== 'excluded') return state

  return {
    ...state,
    lifecycle: 'active',
    updatedAt: Math.max(state.updatedAt, event.now),
    nextReviewAt: event.now,
    exclusion: undefined,
  }
}

/**
 * Remove every occurrence of a word from an unfinished Learn/Review session
 * while preserving the logical cursor.
 */
/**
 * Reconcile an unfinished Learn checkpoint with persistent lifecycle state.
 *
 * Review sessions may contain only ACTIVE words. Acquisition sessions may
 * contain only words that still have no persistent lifecycle state; ACTIVE
 * means admission already completed and EXCLUDED means the user removed it.
 */
export function sanitizeLearnSessionLifecycle(
  record: IReviewRecord,
  states: IReviewWordState[],
): IReviewRecord {
  if (record.isFinished) return record

  const stateByWord = new Map(states.map((state) => [state.word, state]))
  let sanitized = record

  for (const word of new Set(record.words.map((item) => item.name))) {
    const state = stateByWord.get(word)
    const itemKind =
      record.itemKinds?.[word] ??
      (record.sessionKind === 'acquisition'
        ? 'acquisition'
        : 'review')
    const shouldPrune =
      itemKind === 'acquisition'
        ? state !== undefined
        : !isActiveLearningState(state)

    if (shouldPrune) {
      sanitized = pruneLearnSessionWord(sanitized, word)
    }
  }

  return sanitized
}

export function pruneLearnSessionWord(
  record: IReviewRecord,
  word: string,
): IReviewRecord {
  const originalWords = record.words
  if (!originalWords.some((item) => item.name === word)) return record

  const boundedIndex = Math.min(
    Math.max(record.index, 0),
    Math.max(0, originalWords.length - 1),
  )
  const removedBefore = originalWords
    .slice(0, boundedIndex)
    .filter((item) => item.name === word).length

  const words = originalWords.filter((item) => item.name !== word)
  const exercisePlans = { ...(record.exercisePlans ?? {}) }
  const reinforcementCounts = { ...(record.reinforcementCounts ?? {}) }
  const itemKinds = { ...(record.itemKinds ?? {}) }
  const itemStates = { ...(record.itemStates ?? {}) }
  const acquisitionStates = { ...(record.acquisitionStates ?? {}) }
  delete exercisePlans[word]
  delete reinforcementCounts[word]
  delete itemKinds[word]
  delete itemStates[word]
  delete acquisitionStates[word]

  if (words.length === 0) {
    return {
      ...record,
      words,
      index: 0,
      isFinished: true,
      exercisePlans:
        Object.keys(exercisePlans).length > 0 ? exercisePlans : undefined,
      reinforcementCounts:
        Object.keys(reinforcementCounts).length > 0
          ? reinforcementCounts
          : undefined,
      itemKinds:
        Object.keys(itemKinds).length > 0 ? itemKinds : undefined,
      itemStates:
        Object.keys(itemStates).length > 0 ? itemStates : undefined,
      acquisitionStates:
        Object.keys(acquisitionStates).length > 0
          ? acquisitionStates
          : undefined,
    }
  }

  const nextLogicalIndex = Math.max(0, boundedIndex - removedBefore)
  const isFinished = record.isFinished || nextLogicalIndex >= words.length
  const index = isFinished
    ? Math.max(0, words.length - 1)
    : Math.min(nextLogicalIndex, words.length - 1)

  return {
    ...record,
    words,
    index,
    isFinished,
    exercisePlans:
      Object.keys(exercisePlans).length > 0 ? exercisePlans : undefined,
    reinforcementCounts:
      Object.keys(reinforcementCounts).length > 0
        ? reinforcementCounts
        : undefined,
    itemKinds:
      Object.keys(itemKinds).length > 0 ? itemKinds : undefined,
    itemStates:
      Object.keys(itemStates).length > 0 ? itemStates : undefined,
    acquisitionStates:
      Object.keys(acquisitionStates).length > 0
        ? acquisitionStates
        : undefined,
  }
}
