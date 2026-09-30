import { classifyTypingError } from './classifier'
import { summarizeWordHistory } from './features'
import { readLearningContext } from './learning-context'
import { classificationToReviewOutcome, inferLegacyReviewOutcome, scheduleBasicReview } from './scheduler'
import { readWordTelemetry } from './telemetry'
import { createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
import type { IWordRecord } from '@/utils/db/record'

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
    if (replayedReviewCount === 0 && firstLearningFailure) {
      // Initial learning failure means "eligible for first Review now", not
      // "a Review already happened". Keep reviewCount/stage at zero.
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
