import { isCompletedAcquisitionRecord } from '../../src/learn/admission'
import type { IWordRecord } from '../../src/utils/db/record'

const DAY_SECONDS = 86_400

export type TraceSignature = {
  activeDays: number
  medianFirstKeyLatencyMs: number | null
  hintUseRate: number | null
  reviewSuccessRate: number | null
  acquisitionAttemptsPerAdmittedWord: number | null
  meanDailyInteractions: number
  p95DailyInteractions: number
  reviewSuccessByGap: {
    le2d: number | null
    d2to7: number | null
    d7to30: number | null
    gt30d: number | null
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  )
  return sorted[index]
}

function rate(values: boolean[]): number | null {
  return values.length === 0
    ? null
    : values.filter(Boolean).length / values.length
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildTraceSignature(
  records: IWordRecord[],
): TraceSignature {
  const learn = records
    .filter((record) => record.sourceMode === 'learn')
    .sort((a, b) =>
      a.timeStamp !== b.timeStamp
        ? a.timeStamp - b.timeStamp
        : (a.id ?? 0) - (b.id ?? 0),
    )

  const firstKeyLatency = learn
    .map((record) => record.typingTelemetry?.firstKeyLatencyMs)
    .filter((value): value is number => value !== undefined)

  const review = learn.filter(
    (record) => record.learnItemKind === 'review',
  )
  const reviewSuccess = review.map(
    (record) =>
      record.reviewRatingDecision?.eligible === true &&
      record.reviewRatingDecision.rating !== 'again',
  )

  const acquisition = learn.filter(
    (record) => record.learnItemKind === 'acquisition',
  )
  const admittedWords = new Set(
    acquisition
      .filter(isCompletedAcquisitionRecord)
      .map((record) => record.word),
  )

  const interactionsByDay = new Map<string, number>()
  for (const record of learn) {
    const key = localDateKey(record.timeStamp)
    interactionsByDay.set(
      key,
      (interactionsByDay.get(key) ?? 0) + 1,
    )
  }
  const dailyInteractions = [...interactionsByDay.values()]

  const previousReviewByWord = new Map<string, IWordRecord>()
  const gapBuckets = {
    le2d: [] as boolean[],
    d2to7: [] as boolean[],
    d7to30: [] as boolean[],
    gt30d: [] as boolean[],
  }

  for (const record of review) {
    const previous = previousReviewByWord.get(record.word)
    if (previous) {
      const gapDays =
        (record.timeStamp - previous.timeStamp) / DAY_SECONDS
      const success =
        record.reviewRatingDecision?.eligible === true &&
        record.reviewRatingDecision.rating !== 'again'

      if (gapDays <= 2) gapBuckets.le2d.push(success)
      else if (gapDays <= 7) gapBuckets.d2to7.push(success)
      else if (gapDays <= 30) gapBuckets.d7to30.push(success)
      else gapBuckets.gt30d.push(success)
    }
    previousReviewByWord.set(record.word, record)
  }

  return {
    activeDays: interactionsByDay.size,
    medianFirstKeyLatencyMs: median(firstKeyLatency),
    hintUseRate:
      learn.length === 0
        ? null
        : learn.filter(
            (record) =>
              record.learningContext?.reviewHint !== undefined,
          ).length / learn.length,
    reviewSuccessRate: rate(reviewSuccess),
    acquisitionAttemptsPerAdmittedWord:
      admittedWords.size === 0
        ? null
        : acquisition.length / admittedWords.size,
    meanDailyInteractions:
      dailyInteractions.length === 0
        ? 0
        : dailyInteractions.reduce(
            (sum, value) => sum + value,
            0,
          ) / dailyInteractions.length,
    p95DailyInteractions: quantile(dailyInteractions, 0.95),
    reviewSuccessByGap: {
      le2d: rate(gapBuckets.le2d),
      d2to7: rate(gapBuckets.d2to7),
      d7to30: rate(gapBuckets.d7to30),
      gt30d: rate(gapBuckets.gt30d),
    },
  }
}

export function traceSignatureDistance(
  left: TraceSignature,
  right: TraceSignature,
): number {
  const pairs: Array<[number | null, number | null, number]> = [
    [left.medianFirstKeyLatencyMs, right.medianFirstKeyLatencyMs, 1 / 1500],
    [left.hintUseRate, right.hintUseRate, 2],
    [left.reviewSuccessRate, right.reviewSuccessRate, 2],
    [
      left.acquisitionAttemptsPerAdmittedWord,
      right.acquisitionAttemptsPerAdmittedWord,
      0.5,
    ],
    [
      left.meanDailyInteractions,
      right.meanDailyInteractions,
      1 / 40,
    ],
    [
      left.p95DailyInteractions,
      right.p95DailyInteractions,
      1 / 80,
    ],
    [left.reviewSuccessByGap.le2d, right.reviewSuccessByGap.le2d, 1],
    [left.reviewSuccessByGap.d2to7, right.reviewSuccessByGap.d2to7, 1],
    [left.reviewSuccessByGap.d7to30, right.reviewSuccessByGap.d7to30, 1],
    [left.reviewSuccessByGap.gt30d, right.reviewSuccessByGap.gt30d, 1],
  ]

  let total = 0
  let weight = 0
  for (const [a, b, scale] of pairs) {
    if (a === null || b === null) continue
    total += Math.abs(a - b) * scale
    weight += 1
  }
  return weight === 0 ? Number.POSITIVE_INFINITY : total / weight
}
