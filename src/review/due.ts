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
