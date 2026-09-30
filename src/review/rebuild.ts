import { classifyTypingError } from './classifier'
import { summarizeWordHistory } from './features'
import { readLearningContext } from './learning-context'
import { classificationToReviewOutcome, inferLegacyReviewOutcome, scheduleBasicReview } from './scheduler'
import { readWordTelemetry } from './telemetry'
import { createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
import type { IWordRecord } from '@/utils/db/record'

function compareRecordOrder(left: IWordRecord, right: IWordRecord): number {
  const timeDiff = left.timeStamp - right.timeStamp
  if (timeDiff !== 0) return timeDiff
  return (left.id ?? 0) - (right.id ?? 0)
}

export function hasUnreviewedLearningFailure(records: IWordRecord[]): boolean {
  let latestLearningFailure: IWordRecord | undefined
  let latestReview: IWordRecord | undefined

  for (const record of records) {
    if (record.chapter === -1) {
      if (!latestReview || compareRecordOrder(record, latestReview) > 0) latestReview = record
      continue
    }
    if (record.wrongCount <= 0) continue
    if (!latestLearningFailure || compareRecordOrder(record, latestLearningFailure) > 0) {
      latestLearningFailure = record
    }
  }

  if (!latestLearningFailure) return false
  if (!latestReview) return true
  return compareRecordOrder(latestLearningFailure, latestReview) > 0
}

export function reactivateReviewStateFromLearningEvidence(
  state: IReviewWordState,
  records: IWordRecord[],
  now: number,
): IReviewWordState {
  if (!hasUnreviewedLearningFailure(records)) return state
  if (state.nextReviewAt <= now) return state

  return {
    ...state,
    nextReviewAt: now,
    updatedAt: Math.max(state.updatedAt, now),
  }
}

export function inferReviewOutcomeFromWordRecord(
  record: IWordRecord,
  priorRecords: IWordRecord[],
): ReviewOutcome | undefined {
  // Only records created by Review mode are long-term spaced-review events.
  // Ordinary learning records remain valuable evidence for profiles/seeding,
  // but must never advance the long-term scheduler.
  if (record.chapter !== -1) return undefined

  const telemetry = readWordTelemetry(record)

  // Legacy Review rows can still seed historical outcomes. Clean legacy rows
  // lack enough evidence to replay as a positive spaced-review confirmation.
  if (!telemetry) {
    return record.wrongCount > 0 ? inferLegacyReviewOutcome(record.wrongCount) : undefined
  }

  const classification = classifyTypingError({
    word: record.word,
    wrongCount: record.wrongCount,
    telemetry,
    learningContext: readLearningContext(record),
    history: summarizeWordHistory(priorRecords),
  })

  return classificationToReviewOutcome(classification)
}

export function rebuildBasicStateFromWordRecords(
  dict: string,
  word: string,
  records: IWordRecord[],
  options?: { legacyDueAt?: number },
): IReviewWordState | undefined {
  const sortedRecords = [...records].sort((a, b) => a.timeStamp - b.timeStamp)
  const firstLearningFailure = sortedRecords.find(
    (record) => record.chapter !== -1 && record.wrongCount > 0,
  )
  let state: IReviewWordState | undefined = firstLearningFailure
    ? createInitialReviewWordState(dict, word, firstLearningFailure.timeStamp)
    : undefined
  let replayedReviewCount = 0
  const priorRecords: IWordRecord[] = []

  for (const record of sortedRecords) {
    const outcome = inferReviewOutcomeFromWordRecord(record, priorRecords)

    if (outcome !== undefined) {
      state ??= createInitialReviewWordState(dict, word, record.timeStamp)
      state = scheduleBasicReview({
        state,
        outcome,
        now: record.timeStamp,
      })
      replayedReviewCount += 1
    }

    priorRecords.push(record)
  }

  if (state && options?.legacyDueAt !== undefined) {
    if (hasUnreviewedLearningFailure(sortedRecords)) {
      // A fresh ordinary-learning failure re-opens Review immediately without
      // fabricating a Review event or mutating long-term scheduler history.
      state = {
        ...state,
        nextReviewAt: options.legacyDueAt,
        updatedAt: options.legacyDueAt,
      }
    } else if (replayedReviewCount === 0 && firstLearningFailure) {
      state = {
        ...state,
        nextReviewAt: options.legacyDueAt,
        updatedAt: options.legacyDueAt,
      }
    } else {
      const reviewRecords = sortedRecords.filter((record) => record.chapter === -1)
      const hasAdaptiveReviewTelemetry = reviewRecords.some(
        (record) => readWordTelemetry(record) !== undefined,
      )
      if (!hasAdaptiveReviewTelemetry) {
        state = {
          ...state,
          nextReviewAt: options.legacyDueAt,
          updatedAt: options.legacyDueAt,
        }
      }
    }
  }

  return state
}
