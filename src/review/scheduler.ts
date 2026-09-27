import type { TypingErrorClassification } from './classifier'
import type { IReviewWordState, ReviewOutcome, ReviewSchedulerState } from './types'

export type ReviewScheduleInput = {
  state: IReviewWordState
  outcome: ReviewOutcome
  now: number
}

export interface ReviewSchedulerAdapter {
  readonly kind: ReviewSchedulerState['kind']
  schedule(input: ReviewScheduleInput): IReviewWordState
}

/**
 * Converts typing evidence into the four-grade review vocabulary used by
 * spaced-repetition schedulers. This is intentionally separate from any
 * concrete FSRS implementation.
 */
export function classificationToReviewOutcome(classification: TypingErrorClassification): ReviewOutcome {
  if (classification.cause === 'recall') return 'again'
  if (classification.cause === 'spelling') return 'hard'
  if (classification.cause === 'uncertain') return 'hard'
  return 'good'
}
