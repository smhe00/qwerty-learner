import { getLearningLifecycle } from './lifecycle'
import type { IReviewWordState, ReviewOutcome } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'

export type LearnRatingCounts = Record<ReviewOutcome, number>

export type LearnDailyActivity = {
  date: string
  reviewed: number
  acquired: number
  successRate: number | null
}

export type LearnStatsSnapshot = {
  generatedAt: number
  today: {
    reviewedWords: number
    reviewAttempts: number
    acquiredWords: number
    hintUseRate: number | null
    coldProbePassRate: number | null
  }
  lifecycle: {
    active: number
    due: number
    excluded: number
    unseen: number | null
  }
  scheduler: {
    averageIntervalDays: number | null
    successRate30d: number | null
    ratedEvents30d: number
    ratings30d: LearnRatingCounts
  }
  dailyActivity30d: LearnDailyActivity[]
}

const EMPTY_RATINGS: LearnRatingCounts = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return round1((numerator / denominator) * 100)
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function recentLocalDateKeys(now: number, days: number): string[] {
  const current = new Date(now * 1000)
  current.setHours(12, 0, 0, 0)

  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(current)
    date.setDate(current.getDate() - offset)
    keys.push(localDateKey(Math.floor(date.getTime() / 1000)))
  }
  return keys
}

function isLearnRecord(record: IWordRecord): boolean {
  if (record.sourceMode === 'learn') return true
  if (record.sourceMode === 'typing') return false

  // Transitional records predate sourceMode. Only accept strong Review/Learn
  // provenance instead of treating every chapter=-1 record as long-term Learn.
  return (
    record.chapter === -1 &&
    (record.learnItemKind !== undefined ||
      record.reviewRatingDecision !== undefined)
  )
}

function isPrimaryLearnAttempt(record: IWordRecord): boolean {
  if (!isLearnRecord(record)) return false

  const decision = record.reviewRatingDecision
  if (
    decision?.eligible === false &&
    (decision.reason === 'non-cold-attempt' ||
      decision.reason === 'training-event')
  ) {
    return false
  }

  return true
}

function isAcquisition(record: IWordRecord): boolean {
  return record.learnItemKind === 'acquisition'
}

function uniqueWordCount(records: IWordRecord[]): number {
  return new Set(records.map((record) => record.word)).size
}

function isColdProbePass(record: IWordRecord): boolean {
  return (
    record.wrongCount === 0 &&
    !record.learningContext?.reviewHint &&
    record.reviewRatingDecision?.rating !== 'again'
  )
}

function schedulerIntervalDays(state: IReviewWordState): number | undefined {
  if (
    state.schedulerState.kind === 'basic-v1' ||
    state.schedulerState.kind === 'basic-v2'
  ) {
    return state.schedulerState.intervalDays
  }
  return undefined
}

export function buildLearnStatsSnapshot(input: {
  now: number
  dict: string
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
  dictionaryWords?: string[]
}): LearnStatsSnapshot {
  const records = input.wordRecords.filter(
    (record) => record.dict === input.dict && isPrimaryLearnAttempt(record),
  )
  const states = input.wordStates.filter((state) => state.dict === input.dict)
  const todayKey = localDateKey(input.now)
  const dateKeys = recentLocalDateKeys(input.now, 30)
  const dateKeySet = new Set(dateKeys)

  const todayRecords = records.filter(
    (record) => localDateKey(record.timeStamp) === todayKey,
  )
  const todayAcquisition = todayRecords.filter(isAcquisition)
  const todayReview = todayRecords.filter((record) => !isAcquisition(record))

  const hintCount = todayRecords.filter(
    (record) => record.learningContext?.reviewHint !== undefined,
  ).length
  const coldPassCount = todayReview.filter(isColdProbePass).length

  const activeStates = states.filter(
    (state) => getLearningLifecycle(state) === 'active',
  )
  const excludedStates = states.filter(
    (state) => getLearningLifecycle(state) === 'excluded',
  )
  const dueStates = activeStates.filter(
    (state) => state.nextReviewAt <= input.now,
  )

  const knownWords = new Set(states.map((state) => state.word))
  const unseen =
    input.dictionaryWords === undefined
      ? null
      : new Set(
          input.dictionaryWords.filter(
            (word) => word && !knownWords.has(word),
          ),
        ).size

  const intervals = activeStates
    .map(schedulerIntervalDays)
    .filter((value): value is number => value !== undefined)
  const averageIntervalDays =
    intervals.length === 0
      ? null
      : round1(
          intervals.reduce((sum, value) => sum + value, 0) /
            intervals.length,
        )

  const recentRecords = records.filter((record) =>
    dateKeySet.has(localDateKey(record.timeStamp)),
  )
  const recentRated = recentRecords.filter(
    (record) => record.reviewRatingDecision?.eligible === true,
  )
  const ratings30d: LearnRatingCounts = { ...EMPTY_RATINGS }
  for (const record of recentRated) {
    const rating = record.reviewRatingDecision?.rating
    if (rating) ratings30d[rating] += 1
  }

  const successfulRated = recentRated.filter(
    (record) => record.reviewRatingDecision?.rating !== 'again',
  ).length

  const dailyActivity30d = dateKeys.map((date) => {
    const daily = recentRecords.filter(
      (record) => localDateKey(record.timeStamp) === date,
    )
    const dailyRated = daily.filter(
      (record) => record.reviewRatingDecision?.eligible === true,
    )
    const dailySuccessful = dailyRated.filter(
      (record) => record.reviewRatingDecision?.rating !== 'again',
    ).length

    return {
      date,
      reviewed: uniqueWordCount(
        daily.filter((record) => !isAcquisition(record)),
      ),
      acquired: uniqueWordCount(daily.filter(isAcquisition)),
      successRate: rate(dailySuccessful, dailyRated.length),
    }
  })

  return {
    generatedAt: input.now,
    today: {
      reviewedWords: uniqueWordCount(todayReview),
      reviewAttempts: todayReview.length,
      acquiredWords: uniqueWordCount(todayAcquisition),
      hintUseRate: rate(hintCount, todayRecords.length),
      coldProbePassRate: rate(coldPassCount, todayReview.length),
    },
    lifecycle: {
      active: activeStates.length,
      due: dueStates.length,
      excluded: excludedStates.length,
      unseen,
    },
    scheduler: {
      averageIntervalDays,
      successRate30d: rate(successfulRated, recentRated.length),
      ratedEvents30d: recentRated.length,
      ratings30d,
    },
    dailyActivity30d,
  }
}
