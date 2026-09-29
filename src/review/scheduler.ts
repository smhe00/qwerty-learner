import type { TypingErrorClassification } from './classifier'
import type { ExerciseConditionV1 } from './condition'
import type { ReviewEvidenceV1 } from './evidence'
import { basicReviewIntervalsDays, sameSessionWindowSeconds } from './policy'
import type { BasicSchedulerState, IReviewWordState, ReviewOutcome, ReviewSchedulerState } from './types'

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
  if (classification.attentionUncertain) return 'hard'
  if (classification.cause === 'recall') return 'again'
  if (classification.cause === 'spelling') return 'hard'
  if (classification.cause === 'uncertain') return 'hard'
  return 'good'
}


const DAY_SECONDS = 24 * 60 * 60

function intervalForStage(stage: number): number {
  const boundedStage = Math.min(Math.max(stage, 0), basicReviewIntervalsDays.length - 1)
  return basicReviewIntervalsDays[boundedStage]
}

export function scheduleBasicReview(input: ReviewScheduleInput): IReviewWordState {
  const current = input.state.schedulerState
  if (current.kind !== 'basic-v1') {
    throw new Error(`basic-v1 scheduler cannot update ${current.kind} state`)
  }

  const isFirstReview = input.state.reviewCount === 0
  const isDue = isFirstReview || input.now >= input.state.nextReviewAt
  const secondsSinceLastReview =
    input.state.lastReviewedAt === undefined ? undefined : Math.max(0, input.now - input.state.lastReviewedAt)
  const isSameSession =
    !isFirstReview && secondsSinceLastReview !== undefined && secondsSinceLastReview <= sameSessionWindowSeconds
  const countsAsLongTermReview = isDue || (input.outcome === 'again' && !isSameSession)
  let nextStage = current.stage

  if (input.outcome === 'again') {
    nextStage = 0
  } else if (input.outcome === 'hard') {
    nextStage = Math.max(0, isFirstReview ? 0 : current.stage)
  } else if (input.outcome === 'easy') {
    nextStage = isFirstReview
      ? 1
      : isDue
        ? Math.min(current.stage + 2, basicReviewIntervalsDays.length - 1)
        : current.stage
  } else {
    nextStage = isFirstReview
      ? 0
      : isDue
        ? Math.min(current.stage + 1, basicReviewIntervalsDays.length - 1)
        : current.stage
  }

  const intervalDays = intervalForStage(nextStage)
  const shouldReschedule = isDue || (input.outcome === 'again' && !isSameSession)
  const nextSchedulerState: BasicSchedulerState = {
    kind: 'basic-v1',
    stage: nextStage,
    intervalDays,
  }

  return {
    ...input.state,
    updatedAt: input.now,
    lastReviewedAt: input.now,
    nextReviewAt: shouldReschedule ? input.now + intervalDays * DAY_SECONDS : input.state.nextReviewAt,
    reviewCount: input.state.reviewCount + (countsAsLongTermReview ? 1 : 0),
    lapseCount: input.state.lapseCount + (countsAsLongTermReview && input.outcome === 'again' ? 1 : 0),
    cleanStreak: countsAsLongTermReview
      ? input.outcome === 'again'
        ? 0
        : input.state.cleanStreak + 1
      : input.state.cleanStreak,
    lastOutcome: input.outcome,
    schedulerState: nextSchedulerState,
  }
}

export const basicReviewScheduler: ReviewSchedulerAdapter = {
  kind: 'basic-v1',
  schedule: scheduleBasicReview,
}

export function inferLegacyReviewOutcome(wrongCount: number): ReviewOutcome {
  if (wrongCount >= 2) return 'again'
  if (wrongCount === 1) return 'hard'
  return 'good'
}

export function reviewOutcomeForAttempt(input: {
  classification: TypingErrorClassification
  evidence: ReviewEvidenceV1
  condition?: ExerciseConditionV1
}): ReviewOutcome {
  const isAudioWithdrawalProbe =
    input.condition?.purpose === 'probe' &&
    input.condition.probeDimension === 'audio'

  return isAudioWithdrawalProbe
    ? input.evidence.memoryGrade
    : classificationToReviewOutcome(input.classification)
}
