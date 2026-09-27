import type { TypingErrorClassification } from './classifier'
import { basicReviewIntervalsDays } from './policy'
import { createInitialReviewWordState } from './types'
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
  const nextSchedulerState: BasicSchedulerState = {
    kind: 'basic-v1',
    stage: nextStage,
    intervalDays,
  }

  return {
    ...input.state,
    updatedAt: input.now,
    lastReviewedAt: input.now,
    nextReviewAt: input.now + intervalDays * DAY_SECONDS,
    reviewCount: input.state.reviewCount + 1,
    lapseCount: input.state.lapseCount + (input.outcome === 'again' ? 1 : 0),
    cleanStreak: input.outcome === 'again' ? 0 : input.state.cleanStreak + 1,
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


export type LegacyReviewEvidence = {
  timeStamp: number
  wrongCount: number
}

export function rebuildBasicStateFromLegacy(
  dict: string,
  word: string,
  records: LegacyReviewEvidence[],
): IReviewWordState | undefined {
  const sortedRecords = [...records].sort((a, b) => a.timeStamp - b.timeStamp)
  const firstRecord = sortedRecords[0]
  if (!firstRecord) return undefined

  let state = createInitialReviewWordState(dict, word, firstRecord.timeStamp)
  for (const record of sortedRecords) {
    state = scheduleBasicReview({
      state,
      outcome: inferLegacyReviewOutcome(record.wrongCount),
      now: record.timeStamp,
    })
  }

  return state
}
