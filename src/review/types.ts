export const CURRENT_REVIEW_STATE_VERSION = 5

export type ReviewOutcome = 'again' | 'hard' | 'good' | 'easy'

export type BasicSchedulerState = {
  kind: 'basic-v2'
  stage: number
  intervalDays: number
}

export type Fsrs6SchedulerState = {
  kind: 'fsrs6'
  difficulty: number
  stability: number
  parameterSetId?: string
}

export type ReviewSchedulerState =
  | BasicSchedulerState
  | Fsrs6SchedulerState

export type PersistentLearningLifecycle = 'active' | 'excluded'

export type LearningExclusionV1 = {
  reason: 'manual'
  excludedAt: number
}

export interface IReviewWordState {
  id?: number
  dict: string
  word: string
  createdAt: number
  updatedAt: number
  lastReviewedAt?: number
  nextReviewAt: number
  reviewCount: number
  lapseCount: number
  cleanStreak: number
  lastOutcome?: ReviewOutcome

  // Product-level Learn lifecycle. Legacy rows without this field are ACTIVE.
  lifecycle?: PersistentLearningLifecycle
  exclusion?: LearningExclusionV1

  stateVersion: number
  schedulerState: ReviewSchedulerState
}

export function createInitialReviewWordState(dict: string, word: string, now: number): IReviewWordState {
  return {
    dict,
    word,
    createdAt: now,
    updatedAt: now,
    nextReviewAt: now,
    reviewCount: 0,
    lapseCount: 0,
    cleanStreak: 0,
    lifecycle: 'active',
    stateVersion: CURRENT_REVIEW_STATE_VERSION,
    schedulerState: {
      kind: 'basic-v2',
      stage: 0,
      intervalDays: 0,
    },
  }
}
