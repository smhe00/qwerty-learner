import { classifyTypingError } from './classifier'
import { extractTypingBehaviorFeatures, summarizeWordHistory } from './features'
import type { TypingBehaviorFeatures, WordHistorySummary } from './features'
import { readLearningContext } from './learning-context'
import { typingClassifierPolicy } from './policy'
import { getDueReviewWordStates, getReviewWordState } from './repository'
import { readWordTelemetry } from './telemetry'
import type { TypingErrorClassification } from './classifier'
import type { IReviewWordState } from './types'
import { db } from '@/utils/db'
import type { IWordRecord, LearningContextV1 } from '@/utils/db/record'

export type ReviewDiagnosticLatestRecord = {
  id?: number
  timeStamp: number
  wrongCount: number
  telemetryAvailable: boolean
  learningContext?: LearningContextV1
}

export type ReviewWordDiagnostics = {
  dict: string
  word: string
  now: number
  state?: IReviewWordState
  due: boolean
  secondsUntilDue?: number
  nextReviewAtIso?: string
  history: WordHistorySummary
  latestRecord?: ReviewDiagnosticLatestRecord
  latestClassification?: TypingErrorClassification
  latestFeatures?: TypingBehaviorFeatures
  evidenceTags: string[]
}

function toIso(unixSeconds: number | undefined): string | undefined {
  if (unixSeconds === undefined) return undefined
  return new Date(unixSeconds * 1000).toISOString()
}

function buildEvidenceTags(
  features: TypingBehaviorFeatures | undefined,
  classification?: TypingErrorClassification,
): string[] {
  if (!features) return []

  const tags: string[] = []

  if (classification?.attentionUncertain) {
    tags.push('attention-uncertain')
  }

  if (features.firstKeyLatencyMs !== undefined) {
    if (features.firstKeyLatencyMs >= typingClassifierPolicy.veryLongFirstKeyMs) {
      tags.push('very-long-first-key')
    } else if (features.firstKeyLatencyMs >= typingClassifierPolicy.longFirstKeyMs) {
      tags.push('long-first-key')
    } else if (features.firstKeyLatencyMs <= typingClassifierPolicy.fastFirstKeyMs) {
      tags.push('fast-first-key')
    }
  }

  if (features.repeatedWrongPositionRatio >= 0.75 && features.wrongAttemptCount >= 2) {
    tags.push('repeated-same-position')
  }

  if (features.adjacentWrongRatio >= typingClassifierPolicy.motorAdjacentRatio) {
    tags.push('adjacent-key-errors')
  }

  if (features.maxInterKeyMs !== undefined && features.maxInterKeyMs >= typingClassifierPolicy.slowInterKeyMs) {
    tags.push('long-within-word-pause')
  }

  if ((features.history?.recordCount ?? 0) >= 3) {
    if ((features.history?.failureRate ?? 0) >= 0.6) {
      tags.push('high-historical-failure-rate')
    }
    if ((features.history?.dominantWrongIndexRatio ?? 0) >= 0.7) {
      tags.push('stable-historical-error-position')
    }
  }

  if (features.wrongAttemptCount >= 3 && features.uniqueWrongPositionCount >= 2) {
    tags.push('multiple-varied-failures')
  }

  return tags
}


export function buildReviewWordDiagnostics(input: {
  dict: string
  word: string
  now: number
  records: IWordRecord[]
  state?: IReviewWordState
}): ReviewWordDiagnostics {
  const records = [...input.records].sort((a, b) => a.timeStamp - b.timeStamp)
  const latest = records.length > 0 ? records[records.length - 1] : undefined
  const priorRecords = latest ? records.slice(0, -1) : []
  const history = summarizeWordHistory(records)

  let latestClassification: TypingErrorClassification | undefined
  let latestFeatures: TypingBehaviorFeatures | undefined
  let latestRecord: ReviewDiagnosticLatestRecord | undefined

  if (latest) {
    const telemetry = readWordTelemetry(latest)
    const priorHistory = summarizeWordHistory(priorRecords)

    latestFeatures = extractTypingBehaviorFeatures(latest.word, latest.wrongCount, telemetry, priorHistory)
    latestClassification = classifyTypingError({
      word: latest.word,
      wrongCount: latest.wrongCount,
      telemetry,
      learningContext: readLearningContext(latest),
      history: priorHistory,
    })

    latestRecord = {
      id: latest.id,
      timeStamp: latest.timeStamp,
      wrongCount: latest.wrongCount,
      telemetryAvailable: telemetry !== undefined,
      learningContext: readLearningContext(latest),
    }
  }

  const due = input.state ? input.state.nextReviewAt <= input.now : false
  const secondsUntilDue = input.state ? input.state.nextReviewAt - input.now : undefined

  return {
    dict: input.dict,
    word: input.word,
    now: input.now,
    state: input.state,
    due,
    secondsUntilDue,
    nextReviewAtIso: toIso(input.state?.nextReviewAt),
    history,
    latestRecord,
    latestClassification,
    latestFeatures,
    evidenceTags: buildEvidenceTags(latestFeatures, latestClassification),
  }
}

export async function getReviewWordDiagnostics(
  dict: string,
  word: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ReviewWordDiagnostics> {
  const [records, state] = await Promise.all([
    db.wordRecords
      .where('word')
      .equals(word)
      .and((record) => record.dict === dict)
      .toArray(),
    getReviewWordState(dict, word),
  ])

  return buildReviewWordDiagnostics({
    dict,
    word,
    now,
    records,
    state,
  })
}

export type DueReviewDiagnostic = {
  word: string
  nextReviewAt: number
  nextReviewAtIso: string
  reviewCount: number
  lapseCount: number
  cleanStreak: number
  lastOutcome?: IReviewWordState['lastOutcome']
  schedulerState: IReviewWordState['schedulerState']
}

export async function getDueReviewDiagnostics(
  dict: string,
  now = Math.floor(Date.now() / 1000),
): Promise<DueReviewDiagnostic[]> {
  const states = await getDueReviewWordStates(dict, now)

  return states
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
    .map((state) => ({
      word: state.word,
      nextReviewAt: state.nextReviewAt,
      nextReviewAtIso: toIso(state.nextReviewAt) ?? '',
      reviewCount: state.reviewCount,
      lapseCount: state.lapseCount,
      cleanStreak: state.cleanStreak,
      lastOutcome: state.lastOutcome,
      schedulerState: state.schedulerState,
    }))
}


export type ReviewDictionaryDiagnostics = {
  dict: string
  now: number
  wordRecordCount: number
  uniqueWordCount: number
  telemetryRecordCount: number
  telemetryCoverage: number
  stateCount: number
  dueCount: number
  causeCounts: Record<'clean' | 'recall' | 'spelling' | 'motor' | 'uncertain', number>
  basicStageCounts: Record<string, number>
}

export function buildReviewDictionaryDiagnostics(input: {
  dict: string
  now: number
  records: IWordRecord[]
  states: IReviewWordState[]
}): ReviewDictionaryDiagnostics {
  const recordsByWord = new Map<string, IWordRecord[]>()
  let telemetryRecordCount = 0

  for (const record of input.records) {
    if (readWordTelemetry(record)) {
      telemetryRecordCount += 1
    }

    const group = recordsByWord.get(record.word)
    if (group) {
      group.push(record)
    } else {
      recordsByWord.set(record.word, [record])
    }
  }

  const causeCounts: ReviewDictionaryDiagnostics['causeCounts'] = {
    clean: 0,
    recall: 0,
    spelling: 0,
    motor: 0,
    uncertain: 0,
  }

  for (const [word, records] of recordsByWord) {
    const sorted = [...records].sort((a, b) => a.timeStamp - b.timeStamp)
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : undefined
    if (!latest) continue

    const priorHistory = summarizeWordHistory(sorted.slice(0, -1))
    const classification = classifyTypingError({
      word,
      wrongCount: latest.wrongCount,
      telemetry: readWordTelemetry(latest),
      learningContext: readLearningContext(latest),
      history: priorHistory,
    })
    causeCounts[classification.cause] += 1
  }

  const basicStageCounts: Record<string, number> = {}
  for (const state of input.states) {
    if (state.schedulerState.kind === 'basic-v1') {
      const key = String(state.schedulerState.stage)
      basicStageCounts[key] = (basicStageCounts[key] ?? 0) + 1
    }
  }

  return {
    dict: input.dict,
    now: input.now,
    wordRecordCount: input.records.length,
    uniqueWordCount: recordsByWord.size,
    telemetryRecordCount,
    telemetryCoverage: input.records.length > 0 ? telemetryRecordCount / input.records.length : 0,
    stateCount: input.states.length,
    dueCount: input.states.filter((state) => state.nextReviewAt <= input.now).length,
    causeCounts,
    basicStageCounts,
  }
}

export async function getReviewDictionaryDiagnostics(
  dict: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ReviewDictionaryDiagnostics> {
  const [records, states] = await Promise.all([
    db.wordRecords.where('dict').equals(dict).toArray(),
    db.reviewWordStates.where('dict').equals(dict).toArray(),
  ])

  return buildReviewDictionaryDiagnostics({
    dict,
    now,
    records,
    states,
  })
}
