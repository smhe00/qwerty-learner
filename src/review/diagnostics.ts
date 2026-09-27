import { classifyTypingError } from './classifier'
import { extractTypingBehaviorFeatures, summarizeWordHistory } from './features'
import type { TypingBehaviorFeatures, WordHistorySummary } from './features'
import { getDueReviewWordStates, getReviewWordState } from './repository'
import { readWordTelemetry } from './telemetry'
import type { TypingErrorClassification } from './classifier'
import type { IReviewWordState } from './types'
import { db } from '@/utils/db'

export type ReviewDiagnosticLatestRecord = {
  id?: number
  timeStamp: number
  wrongCount: number
  telemetryAvailable: boolean
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
}

function toIso(unixSeconds: number | undefined): string | undefined {
  if (unixSeconds === undefined) return undefined
  return new Date(unixSeconds * 1000).toISOString()
}

export function buildReviewWordDiagnostics(input: {
  dict: string
  word: string
  now: number
  records: Awaited<ReturnType<typeof db.wordRecords.toArray>>
  state?: IReviewWordState
}): ReviewWordDiagnostics {
  const records = [...input.records].sort((a, b) => a.timeStamp - b.timeStamp)
  const latest = records.at(-1)
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
      history: priorHistory,
    })

    latestRecord = {
      id: latest.id,
      timeStamp: latest.timeStamp,
      wrongCount: latest.wrongCount,
      telemetryAvailable: telemetry !== undefined,
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
