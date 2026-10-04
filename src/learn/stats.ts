import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
  LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION,
} from './acquisition'
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
    coldProbeAttempts: number
    acquiredWords: number
    hintUseRate: number | null
    coldProbePassRate: number | null
  }
  lifecycle: {
    active: number
    due: number
    difficultDue: number
    excluded: number
    unseen: number | null
  }
  effort: {
    todayActiveSeconds: number
    medianReviewSeconds: number | null
    medianAcquisitionSeconds: number | null
    recentReviewSamples: number
    recentAcquisitionSamples: number
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

function isCompletedAcquisition(record: IWordRecord): boolean {
  if (!isAcquisition(record)) return false

  const policyVersion = record.reviewPolicyDecision?.policyVersion

  // Phased acquisition attempts are not "new words learned" until the
  // delayed, unaided Independent attempt succeeds cleanly.
  if (
    policyVersion === LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION ||
    policyVersion === LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION
  ) {
    return false
  }

  if (policyVersion === LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION) {
    return (
      record.wrongCount === 0 &&
      record.learningContext?.reviewHint === undefined &&
      record.reviewEvidence?.retrievalValidity === 'independent'
    )
  }

  // A Hint plan can replace the Independent plan during the attempt. Such an
  // assisted completion is deliberately not an admission.
  if (record.learningContext?.reviewHint !== undefined) return false

  // Compatibility: acquisition records from the old one-pass rollout were
  // admitted immediately and have to keep their historical statistics.
  return (
    policyVersion === undefined ||
    policyVersion === 'learn-acquisition-cold-probe-v2'
  )
}

function uniqueWordCount(records: IWordRecord[]): number {
  return new Set(records.map((record) => record.word)).size
}

function isColdProbePass(record: IWordRecord): boolean {
  return (
    record.reviewRatingDecision?.eligible === true &&
    record.wrongCount === 0 &&
    !record.learningContext?.reviewHint &&
    record.reviewRatingDecision.rating !== 'again'
  )
}

function recordActiveSeconds(record: IWordRecord): number | null {
  const attempts = record.typingTelemetry?.attempts
  if (attempts && attempts.length > 0) {
    const seconds =
      attempts.reduce(
        (sum, attempt) =>
          sum + attempt.startLatencyMs + attempt.durationMs,
        0,
      ) / 1000
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  if (record.timing.length > 0) {
    const seconds =
      record.timing.reduce((sum, interval) => sum + interval, 0) / 1000
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  return null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle]
  return round1(value)
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
  const learnRecords = input.wordRecords.filter(
    (record) => record.dict === input.dict && isLearnRecord(record),
  )
  const records = learnRecords.filter(isPrimaryLearnAttempt)
  const states = input.wordStates.filter((state) => state.dict === input.dict)
  const todayKey = localDateKey(input.now)
  const dateKeys = recentLocalDateKeys(input.now, 30)
  const dateKeySet = new Set(dateKeys)

  const todayRecords = records.filter(
    (record) => localDateKey(record.timeStamp) === todayKey,
  )
  const todayLearnRecords = learnRecords.filter(
    (record) => localDateKey(record.timeStamp) === todayKey,
  )
  const todayAcquisition = todayRecords.filter(isAcquisition)
  const todayCompletedAcquisition =
    todayAcquisition.filter(isCompletedAcquisition)
  const todayReview = todayRecords.filter((record) => !isAcquisition(record))

  const hintCount = todayRecords.filter(
    (record) => record.learningContext?.reviewHint !== undefined,
  ).length
  const todayColdProbe = todayReview.filter(
    (record) => record.reviewRatingDecision?.eligible === true,
  )
  const coldPassCount = todayColdProbe.filter(isColdProbePass).length

  const activeStates = states.filter(
    (state) => getLearningLifecycle(state) === 'active',
  )
  const excludedStates = states.filter(
    (state) => getLearningLifecycle(state) === 'excluded',
  )
  const dueStates = activeStates.filter(
    (state) => state.nextReviewAt <= input.now,
  )
  const difficultDueStates = dueStates.filter(
    (state) =>
      state.lastOutcome === 'again' ||
      state.lastOutcome === 'hard' ||
      (state.lapseCount > 0 && state.cleanStreak === 0),
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
  const todayActiveSeconds = round1(
    todayLearnRecords.reduce(
      (sum, record) => sum + (recordActiveSeconds(record) ?? 0),
      0,
    ),
  )
  const recentReviewSeconds = recentRecords
    .filter((record) => !isAcquisition(record))
    .map(recordActiveSeconds)
    .filter((value): value is number => value !== null)
  const recentAcquisitionSeconds = recentRecords
    .filter(isAcquisition)
    .map(recordActiveSeconds)
    .filter((value): value is number => value !== null)

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
      acquired: uniqueWordCount(daily.filter(isCompletedAcquisition)),
      successRate: rate(dailySuccessful, dailyRated.length),
    }
  })

  return {
    generatedAt: input.now,
    today: {
      reviewedWords: uniqueWordCount(todayReview),
      reviewAttempts: todayReview.length,
      coldProbeAttempts: todayColdProbe.length,
      acquiredWords: uniqueWordCount(todayCompletedAcquisition),
      hintUseRate: rate(hintCount, todayRecords.length),
      coldProbePassRate: rate(coldPassCount, todayColdProbe.length),
    },
    lifecycle: {
      active: activeStates.length,
      due: dueStates.length,
      difficultDue: difficultDueStates.length,
      excluded: excludedStates.length,
      unseen,
    },
    effort: {
      todayActiveSeconds,
      medianReviewSeconds: median(recentReviewSeconds),
      medianAcquisitionSeconds: median(recentAcquisitionSeconds),
      recentReviewSamples: recentReviewSeconds.length,
      recentAcquisitionSamples: recentAcquisitionSeconds.length,
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
