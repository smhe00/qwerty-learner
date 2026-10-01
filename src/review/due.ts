import { isActiveLearningState } from '@/learn/lifecycle'
import type { IReviewWordState } from './types'

export type DueReviewCandidate = {
  word: string
}

export function filterDueReviewCandidates<T extends DueReviewCandidate>(
  candidates: T[],
  dueStates: IReviewWordState[],
): T[] {
  const dueWords = new Set(
    dueStates.filter(isActiveLearningState).map((state) => state.word),
  )
  return candidates.filter((candidate) => dueWords.has(candidate.word))
}

export type ReviewSelectionMode = 'due' | 'force'

export function selectReviewCandidates<T extends DueReviewCandidate>(
  candidates: T[],
  states: IReviewWordState[],
  now: number,
  mode: ReviewSelectionMode = 'due',
): T[] {
  const activeWords = new Set(
    states.filter(isActiveLearningState).map((state) => state.word),
  )

  if (mode === 'force') {
    return candidates.filter((candidate) => activeWords.has(candidate.word))
  }

  const dueWords = new Set(
    states
      .filter(
        (state) =>
          isActiveLearningState(state) && state.nextReviewAt <= now,
      )
      .map((state) => state.word),
  )
  return candidates.filter((candidate) => dueWords.has(candidate.word))
}
