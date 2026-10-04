import { getLearningLifecycle } from './lifecycle'
import type { IReviewWordState } from '@/review/types'

export const LONG_TERM_MASTERY_DAYS = 30

/**
 * Product-level Learn mastery contract.
 *
 * "Long-term mastered" means the active scheduler has earned at least a
 * 30-day memory horizon and the latest rated outcome is not a lapse.
 * This lives in Learn, not Achievement, so stats/UI/FSRS can share one
 * authoritative definition.
 */
export function isLongTermMastered(
  state: IReviewWordState | undefined,
): boolean {
  if (!state || getLearningLifecycle(state) !== 'active') return false
  if (state.lastOutcome === 'again') return false

  const scheduler = state.schedulerState
  if (
    scheduler.kind === 'basic-v1' ||
    scheduler.kind === 'basic-v2'
  ) {
    return scheduler.intervalDays >= LONG_TERM_MASTERY_DAYS
  }

  if (scheduler.kind === 'fsrs6') {
    return scheduler.stability >= LONG_TERM_MASTERY_DAYS
  }

  return false
}

export function countLongTermMasteredWords(
  states: IReviewWordState[],
): number {
  return new Set(
    states
      .filter(isLongTermMastered)
      .map((state) => state.word),
  ).size
}

export function didEnterLongTermMastery(
  previous: IReviewWordState | undefined,
  next: IReviewWordState,
): boolean {
  return !isLongTermMastered(previous) && isLongTermMastered(next)
}
