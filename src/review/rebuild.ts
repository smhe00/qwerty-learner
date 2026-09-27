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
  const telemetry = readWordTelemetry(record)

  // Legacy qwerty-learner clean rows were ordinary typing practice, not
  // spaced-review confirmations. Replaying them as "good" would overstate
  // mastery and can push imported historical error words into the future.
  // Legacy failures remain useful evidence; new telemetry rows retain their
  // full adaptive semantics, including clean attempts.
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
  let state: IReviewWordState | undefined
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
    }

    priorRecords.push(record)
  }

  if (state && options?.legacyDueAt !== undefined) {
    const hasAdaptiveTelemetry = sortedRecords.some((record) => readWordTelemetry(record) !== undefined)
    if (!hasAdaptiveTelemetry) {
      state = {
        ...state,
        nextReviewAt: options.legacyDueAt,
        updatedAt: options.legacyDueAt,
      }
    }
  }

  return state
}
