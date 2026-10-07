import type { ReviewOutcome } from '../types'

export const FSRS_SHADOW_SCHEMA_VERSION = 1 as const
export const FSRS_SHADOW_LIBRARY_VERSION = '5.4.2' as const
export const FSRS_SHADOW_ALGORITHM_MODEL = 'fsrs-6' as const
export const FSRS_SHADOW_PARAMETER_SET_ID =
  'fsrs6-default-r0.88-no-fuzz-long-term-v1' as const

export type FsrsHistoryCoverage =
  | 'unknown'
  | 'review-count-matched'
  | 'partial-history'
  | 'event-count-exceeds-state'

export type FsrsShadowCardSnapshotV1 = {
  dueAt: number
  lastReviewAt: number | null
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  learningSteps: number
  state: number
}

export type FsrsCounterfactualV1 = {
  dueAt: number
  intervalDays: number
  stability: number
  difficulty: number
  state: number
}

export type FsrsShadowReplayEventV1 = {
  schemaVersion: typeof FSRS_SHADOW_SCHEMA_VERSION
  libraryVersion: typeof FSRS_SHADOW_LIBRARY_VERSION
  algorithmModel: typeof FSRS_SHADOW_ALGORITHM_MODEL
  parameterSetId: typeof FSRS_SHADOW_PARAMETER_SET_ID
  dict: string
  word: string
  sourceRecordId?: number
  eventTime: number
  rating: ReviewOutcome
  retrievabilityBefore: number | null
  before: FsrsShadowCardSnapshotV1
  after: FsrsShadowCardSnapshotV1
  selectedIntervalDays: number
  counterfactual: Record<ReviewOutcome, FsrsCounterfactualV1>
}

export type FsrsShadowReplayResultV1 = {
  schemaVersion: typeof FSRS_SHADOW_SCHEMA_VERSION
  libraryVersion: typeof FSRS_SHADOW_LIBRARY_VERSION
  algorithmModel: typeof FSRS_SHADOW_ALGORITHM_MODEL
  parameterSetId: typeof FSRS_SHADOW_PARAMETER_SET_ID
  dict: string
  word: string
  historyCoverage: FsrsHistoryCoverage
  currentReviewCount: number | null
  replayedEligibleEvents: number
  ignoredEvents: number
  card: FsrsShadowCardSnapshotV1
  events: FsrsShadowReplayEventV1[]
}

export type FsrsBasicV2ComparatorV1 = {
  dueAt: number
  nominalIntervalDays: number
  reviewCount: number
  lapseCount: number
}

export type FsrsLiveShadowObservationV1 = FsrsShadowReplayEventV1 & {
  historyCoverage: FsrsHistoryCoverage
  replayedEligibleEvents: number
  basicV2: FsrsBasicV2ComparatorV1
}
