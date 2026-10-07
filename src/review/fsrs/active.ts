import {
  hasPrematureModernAcquisitionStateEvidence,
  isCompletedAcquisitionRecord,
} from '@/learn/admission'
import {
  hasUnreviewedLearningFailure,
  inferReviewOutcomeFromWordRecord,
} from '../rebuild'
import {
  FSRS6_ACTIVE_STRATEGY,
  createFsrs6Scheduler,
} from './strategy'
import {
  CURRENT_REVIEW_STATE_VERSION,
  type FsrsLegacyBridgeV1,
  type IReviewWordState,
  type ReviewOutcome,
} from '../types'
import type { IWordRecord } from '@/utils/db/record'
import { Rating, createEmptyCard } from 'ts-fsrs'

const DAY_SECONDS = 86_400

const outcomeToRating: Record<ReviewOutcome, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

function compareRecordOrder(
  left: IWordRecord,
  right: IWordRecord,
): number {
  if (left.timeStamp !== right.timeStamp) {
    return left.timeStamp - right.timeStamp
  }
  return (left.id ?? 0) - (right.id ?? 0)
}

function firstOrdinaryLearningFailure(
  records: readonly IWordRecord[],
): IWordRecord | undefined {
  return records.find(
    (record) =>
      record.sourceMode === 'learn' &&
      record.learnItemKind !== 'acquisition' &&
      record.chapter !== -1 &&
      record.wrongCount > 0,
  )
}

export function isCurrentActiveFsrsState(
  state: IReviewWordState | undefined,
): boolean {
  return (
    state?.schedulerState.kind === 'fsrs6' &&
    state.schedulerState.parameterSetId === FSRS6_ACTIVE_STRATEGY.id
  )
}

function legacyBridgeFromPriorState(
  state: IReviewWordState | undefined,
): FsrsLegacyBridgeV1 | undefined {
  if (!state) return undefined

  if (
    state.schedulerState.kind === 'fsrs6' &&
    state.schedulerState.parameterSetId === FSRS6_ACTIVE_STRATEGY.id
  ) {
    return state.schedulerState.legacyBridge
  }

  return {
    version: 1,
    cutoffAt:
      state.lastReviewedAt ??
      state.updatedAt ??
      state.createdAt,
    reviewCountOffset: state.reviewCount,
    lapseCountOffset: state.lapseCount,
    cleanStreakOffset: state.cleanStreak,
  }
}

export function createInitialFsrsReviewWordState(
  dict: string,
  word: string,
  now: number,
): IReviewWordState {
  const card = createEmptyCard(new Date(now * 1000))

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
      kind: 'fsrs6',
      difficulty: card.difficulty,
      stability: card.stability,
      parameterSetId: FSRS6_ACTIVE_STRATEGY.id,
    },
  }
}

/**
 * Deterministically rebuild the production FSRS-6 state from raw Learn
 * history.
 *
 * For native/current FSRS rows the whole eligible history is replayed.
 * For an opaque legacy scheduler row we never pretend that incomplete raw
 * history is complete: the legacy counters become an immutable bridge offset,
 * the old due date remains authoritative until the next eligible Review, and
 * only post-cutoff ratings are replayed into FSRS.
 */
export function rebuildActiveFsrsStateFromWordRecords(
  dict: string,
  word: string,
  records: readonly IWordRecord[],
  options?: {
    legacyDueAt?: number
    priorState?: IReviewWordState
  },
): IReviewWordState | undefined {
  const sorted = [...records].sort(compareRecordOrder)
  const bridge = legacyBridgeFromPriorState(options?.priorState)

  const firstAdmission = bridge
    ? undefined
    : sorted.find(isCompletedAcquisitionRecord)

  if (
    !bridge &&
    hasPrematureModernAcquisitionStateEvidence([...sorted]) &&
    !firstAdmission
  ) {
    return undefined
  }

  const firstLearningFailure = bridge
    ? undefined
    : firstOrdinaryLearningFailure(sorted)

  const seedAt =
    options?.priorState?.createdAt ??
    firstAdmission?.timeStamp ??
    firstLearningFailure?.timeStamp

  let card =
    !bridge && seedAt !== undefined
      ? createEmptyCard(new Date(seedAt * 1000))
      : undefined
  let createdAt = seedAt
  let reviewCount = bridge?.reviewCountOffset ?? 0
  let lapseCount = bridge?.lapseCountOffset ?? 0
  let cleanStreak = bridge?.cleanStreakOffset ?? 0
  let lastOutcome: ReviewOutcome | undefined = bridge
    ? options?.priorState?.lastOutcome
    : undefined
  let lastReviewedAt: number | undefined = bridge
    ? options?.priorState?.lastReviewedAt
    : undefined
  let replayedEligibleEvents = 0
  const priorRecords: IWordRecord[] = []
  const scheduler = createFsrs6Scheduler(FSRS6_ACTIVE_STRATEGY)

  for (const record of sorted) {
    if (
      bridge &&
      record.timeStamp <= bridge.cutoffAt
    ) {
      priorRecords.push(record)
      continue
    }

    const afterAdmission =
      bridge ||
      !firstAdmission ||
      compareRecordOrder(record, firstAdmission) > 0
    const outcome = afterAdmission
      ? inferReviewOutcomeFromWordRecord(record, priorRecords)
      : undefined

    if (outcome !== undefined) {
      createdAt ??= record.timeStamp
      card ??= createEmptyCard(new Date(record.timeStamp * 1000))
      card = scheduler.next(
        card,
        new Date(record.timeStamp * 1000),
        outcomeToRating[outcome],
      ).card
      reviewCount += 1
      replayedEligibleEvents += 1
      if (outcome === 'again') {
        lapseCount += 1
        cleanStreak = 0
      } else {
        cleanStreak += 1
      }
      lastOutcome = outcome
      lastReviewedAt = record.timeStamp
    }

    priorRecords.push(record)
  }

  if (bridge && replayedEligibleEvents === 0) {
    return undefined
  }

  if (createdAt === undefined || !card) return undefined

  let nextReviewAt = Math.floor(card.due.getTime() / 1000)

  if (!bridge) {
    nextReviewAt =
      reviewCount === 0 && firstAdmission
        ? firstAdmission.timeStamp + DAY_SECONDS
        : nextReviewAt

    if (
      options?.legacyDueAt !== undefined &&
      (
        hasUnreviewedLearningFailure([...sorted]) ||
        (reviewCount === 0 && firstLearningFailure)
      )
    ) {
      nextReviewAt = options.legacyDueAt
    }
  }

  return {
    dict,
    word,
    createdAt,
    updatedAt: lastReviewedAt ?? createdAt,
    ...(lastReviewedAt !== undefined ? { lastReviewedAt } : {}),
    nextReviewAt,
    reviewCount,
    lapseCount,
    cleanStreak,
    ...(lastOutcome !== undefined ? { lastOutcome } : {}),
    lifecycle: options?.priorState?.lifecycle ?? 'active',
    ...(options?.priorState?.exclusion
      ? { exclusion: options.priorState.exclusion }
      : {}),
    stateVersion: CURRENT_REVIEW_STATE_VERSION,
    schedulerState: {
      kind: 'fsrs6',
      difficulty: card.difficulty,
      stability: card.stability,
      parameterSetId: FSRS6_ACTIVE_STRATEGY.id,
      ...(bridge ? { legacyBridge: bridge } : {}),
    },
  }
}
