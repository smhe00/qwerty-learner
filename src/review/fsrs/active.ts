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
 * history. No basic-v2 stage/interval is converted into FSRS D/S.
 */
export function rebuildActiveFsrsStateFromWordRecords(
  dict: string,
  word: string,
  records: readonly IWordRecord[],
  options?: { legacyDueAt?: number },
): IReviewWordState | undefined {
  const sorted = [...records].sort(compareRecordOrder)
  const firstAdmission = sorted.find(isCompletedAcquisitionRecord)

  if (
    hasPrematureModernAcquisitionStateEvidence([...sorted]) &&
    !firstAdmission
  ) {
    return undefined
  }

  const firstLearningFailure = firstOrdinaryLearningFailure(sorted)
  const seedAt =
    firstAdmission?.timeStamp ??
    firstLearningFailure?.timeStamp

  let card =
    seedAt !== undefined
      ? createEmptyCard(new Date(seedAt * 1000))
      : undefined
  let createdAt = seedAt
  let reviewCount = 0
  let lapseCount = 0
  let cleanStreak = 0
  let lastOutcome: ReviewOutcome | undefined
  let lastReviewedAt: number | undefined
  const priorRecords: IWordRecord[] = []
  const scheduler = createFsrs6Scheduler(FSRS6_ACTIVE_STRATEGY)

  for (const record of sorted) {
    const afterAdmission =
      !firstAdmission ||
      compareRecordOrder(record, firstAdmission) > 0
    const outcome = afterAdmission
      ? inferReviewOutcomeFromWordRecord(record, priorRecords)
      : undefined

    if (outcome !== undefined) {
      createdAt ??= record.timeStamp
      card ??= createEmptyCard(new Date(createdAt * 1000))
      card = scheduler.next(
        card,
        new Date(record.timeStamp * 1000),
        outcomeToRating[outcome],
      ).card
      reviewCount += 1
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

  if (createdAt === undefined || !card) return undefined

  let nextReviewAt =
    reviewCount === 0 && firstAdmission
      ? firstAdmission.timeStamp + DAY_SECONDS
      : Math.floor(card.due.getTime() / 1000)

  if (
    options?.legacyDueAt !== undefined &&
    (
      hasUnreviewedLearningFailure([...sorted]) ||
      (reviewCount === 0 && firstLearningFailure)
    )
  ) {
    nextReviewAt = options.legacyDueAt
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
