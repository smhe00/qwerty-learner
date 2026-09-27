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
