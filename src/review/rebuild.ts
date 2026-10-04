import {
  hasPrematureModernAcquisitionStateEvidence,
  isCompletedAcquisitionRecord,
} from '@/learn/admission'
import { isActiveLearningState } from '@/learn/lifecycle'
import { classifyTypingError } from './classifier'
import { summarizeWordHistory } from './features'
import { readLearningContext } from './learning-context'
import { classificationToReviewOutcome, inferLegacyReviewOutcome, scheduleBasicReview } from './scheduler'
import { readWordTelemetry } from './telemetry'
import { createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
import type { IWordRecord } from '@/utils/db/record'

function isLongTermReviewRecord(record: IWordRecord): boolean {
  if (record.sourceMode === 'typing') return false
  if (record.learnItemKind === 'acquisition') return false
  return record.chapter === -1
}

function isExplicitLearnRecord(record: IWordRecord): boolean {
  if (record.sourceMode === 'typing') return false
  if (record.sourceMode === 'learn') return true

  // Legacy long-term Review rows predate sourceMode but used chapter=-1.
  return record.chapter === -1
}

export function shouldDropPrematureAcquisitionState(
  state: IReviewWordState,
  records: IWordRecord[],
): boolean {
  if (!isActiveLearningState(state)) return false
  return hasPrematureModernAcquisitionStateEvidence(records)
}

export function shouldDropLegacyTypingSeededState(
  state: IReviewWordState,
  records: IWordRecord[],
): boolean {
  if (!isActiveLearningState(state)) return false
  if (state.reviewCount !== 0) return false
  if (state.lastReviewedAt !== undefined || state.lastOutcome !== undefined) {
    return false
  }
  if (state.schedulerState.kind === 'fsrs6') return false
  if (state.schedulerState.intervalDays !== 0) return false

  return !records.some(isExplicitLearnRecord)
}

function compareRecordOrder(left: IWordRecord, right: IWordRecord): number {
  const timeDiff = left.timeStamp - right.timeStamp
  if (timeDiff !== 0) return timeDiff
  return (left.id ?? 0) - (right.id ?? 0)
}

export function hasUnreviewedLearningFailure(records: IWordRecord[]): boolean {
  let latestLearningFailure: IWordRecord | undefined
  let latestReview: IWordRecord | undefined

  for (const record of records) {
    if (isLongTermReviewRecord(record)) {
      if (!latestReview || compareRecordOrder(record, latestReview) > 0) latestReview = record
      continue
    }
    if (!isExplicitLearnRecord(record)) continue
    if (record.learnItemKind === 'acquisition') continue
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
  if (!isActiveLearningState(state)) return state
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
  if (!isLongTermReviewRecord(record)) return undefined

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
  const firstAcquisitionAdmission = sortedRecords.find(
    isCompletedAcquisitionRecord,
  )

  // Modern phased Acquisition has a strict admission boundary. If the word
  // has entered Exposure/Supported/Independent but never produced valid
  // spacing-eligible Independent evidence, any later Review rows are
  // contamination from the historical bootstrap bug and must not fabricate an
  // ACTIVE scheduler state.
  if (
    hasPrematureModernAcquisitionStateEvidence(sortedRecords) &&
    !firstAcquisitionAdmission
  ) {
    return undefined
  }

  const firstLearningFailure = sortedRecords.find(
    (record) =>
      record.sourceMode === 'learn' &&
      record.learnItemKind !== 'acquisition' &&
      record.chapter !== -1 &&
      record.wrongCount > 0,
  )

  let state: IReviewWordState | undefined
  if (firstAcquisitionAdmission) {
    state = {
      ...createInitialReviewWordState(
        dict,
        word,
        firstAcquisitionAdmission.timeStamp,
      ),
      nextReviewAt: firstAcquisitionAdmission.timeStamp + 86_400,
      updatedAt: firstAcquisitionAdmission.timeStamp,
    }
  } else if (firstLearningFailure) {
    state = createInitialReviewWordState(
      dict,
      word,
      firstLearningFailure.timeStamp,
    )
  }
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
      const reviewRecords = sortedRecords.filter(isLongTermReviewRecord)
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
