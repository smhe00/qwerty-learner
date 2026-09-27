import { classifyTypingError } from './classifier'
import { summarizeWordHistory } from './features'
import { classificationToReviewOutcome, inferLegacyReviewOutcome, scheduleBasicReview } from './scheduler'
import { readWordTelemetry } from './telemetry'
import { createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
import type { IWordRecord } from '@/utils/db/record'

export function inferReviewOutcomeFromWordRecord(
  record: IWordRecord,
  priorRecords: IWordRecord[],
): ReviewOutcome {
  const telemetry = readWordTelemetry(record)

  if (!telemetry) {
    return inferLegacyReviewOutcome(record.wrongCount)
  }

  const classification = classifyTypingError({
    word: record.word,
    wrongCount: record.wrongCount,
    telemetry,
    history: summarizeWordHistory(priorRecords),
  })

  return classificationToReviewOutcome(classification)
}

export function rebuildBasicStateFromWordRecords(
  dict: string,
  word: string,
  records: IWordRecord[],
): IReviewWordState | undefined {
  const sortedRecords = [...records].sort((a, b) => a.timeStamp - b.timeStamp)
  const firstRecord = sortedRecords[0]
  if (!firstRecord) return undefined

  let state = createInitialReviewWordState(dict, word, firstRecord.timeStamp)
  const priorRecords: IWordRecord[] = []

  for (const record of sortedRecords) {
    state = scheduleBasicReview({
      state,
      outcome: inferReviewOutcomeFromWordRecord(record, priorRecords),
      now: record.timeStamp,
    })
    priorRecords.push(record)
  }

  return state
}
