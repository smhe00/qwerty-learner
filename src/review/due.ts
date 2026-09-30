import type { IReviewWordState } from './types'

export type DueReviewCandidate = {
  word: string
}

export function filterDueReviewCandidates<T extends DueReviewCandidate>(
  candidates: T[],
  dueStates: IReviewWordState[],
): T[] {
  const dueWords = new Set(dueStates.map((state) => state.word))
  return candidates.filter((candidate) => dueWords.has(candidate.word))
}

export type ReviewSelectionMode = 'due' | 'force'

export function selectReviewCandidates<T extends DueReviewCandidate>(
  candidates: T[],
  states: IReviewWordState[],
  now: number,
  mode: ReviewSelectionMode = 'due',
): T[] {
  if (mode === 'force') return [...candidates]

  const dueWords = new Set(
    states.filter((state) => state.nextReviewAt <= now).map((state) => state.word),
  )
  return candidates.filter((candidate) => dueWords.has(candidate.word))
}
