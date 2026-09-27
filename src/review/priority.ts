export type ReviewPriorityCandidate = {
  errorCount: number
  latestErrorTime: number
}

/**
 * Rank review candidates using only signals that already exist in the upstream
 * error-word data model.
 *
 * Higher error count means higher priority. For equal error counts, a more
 * recent error is reviewed first.
 */
export function rankReviewCandidates<T extends ReviewPriorityCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const errorCountDiff = b.errorCount - a.errorCount
    if (errorCountDiff !== 0) return errorCountDiff

    return b.latestErrorTime - a.latestErrorTime
  })
}


import type { IReviewWordState } from './types'

export type DueReviewPriorityCandidate = ReviewPriorityCandidate & {
  word: string
}

function basicStage(state: IReviewWordState | undefined): number {
  if (!state) return Number.MAX_SAFE_INTEGER
  if (state.schedulerState.kind === 'basic-v1') return state.schedulerState.stage

  // FSRS states use a different scale; do not fabricate a cross-algorithm
  // conversion here. Mixed scheduler kinds are not expected during v1.
  return 0
}

/**
 * Rank already-due review candidates without opaque weights.
 *
 * Priority, in order:
 * 1. more historical lapses;
 * 2. weaker current basic-v1 stage;
 * 3. more historical typing errors;
 * 4. longer overdue;
 * 5. more recent error as the final tie breaker.
 */
export function rankDueReviewCandidates<T extends DueReviewPriorityCandidate>(
  candidates: T[],
  dueStates: IReviewWordState[],
): T[] {
  const stateByWord = new Map(dueStates.map((state) => [state.word, state]))

  return [...candidates].sort((a, b) => {
    const stateA = stateByWord.get(a.word)
    const stateB = stateByWord.get(b.word)

    const lapseDiff = (stateB?.lapseCount ?? 0) - (stateA?.lapseCount ?? 0)
    if (lapseDiff !== 0) return lapseDiff

    const stageDiff = basicStage(stateA) - basicStage(stateB)
    if (stageDiff !== 0) return stageDiff

    const errorDiff = b.errorCount - a.errorCount
    if (errorDiff !== 0) return errorDiff

    const dueDiff = (stateA?.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (stateB?.nextReviewAt ?? Number.MAX_SAFE_INTEGER)
    if (dueDiff !== 0) return dueDiff

    return b.latestErrorTime - a.latestErrorTime
  })
}
