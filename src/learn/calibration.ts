import { isCompletedAcquisitionRecord } from './admission'
import type { IWordRecord } from '@/utils/db/record'

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

export type LearnCalibrationCoverageV1 = {
  sourceRecords: number
  learnRecords: number
  reviewRecords: number
  acquisitionRecords: number
  telemetryRecords: number
  hintObservedRecords: number
  ratedReviewRecords: number
  fsrsShadowRecords: number
}

export type LearnCalibrationReportV1 = {
  schemaVersion: 1
  generatedAt: number
  coverage: LearnCalibrationCoverageV1
  signature: TraceSignature
}

export type LearnCalibrationSplit = {
  holdoutStartAt: number
  training: IWordRecord[]
  holdout: IWordRecord[]
}

export type TraceMetricName =
  | 'medianFirstKeyLatencyMs'
  | 'hintUseRate'
  | 'reviewSuccessRate'
  | 'acquisitionAttemptsPerAdmittedWord'
  | 'meanDailyInteractions'
  | 'p95DailyInteractions'
  | 'reviewSuccessByGap.le2d'
  | 'reviewSuccessByGap.d2to7'
  | 'reviewSuccessByGap.d7to30'
  | 'reviewSuccessByGap.gt30d'

export type TraceSignatureComparisonV1 = {
  distance: number
  comparableMetrics: number
  missingMetrics: TraceMetricName[]
  absoluteDeltas: Partial<Record<TraceMetricName, number>>
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

function sortRecords(
  records: readonly IWordRecord[],
): IWordRecord[] {
  return [...records].sort((a, b) =>
    a.timeStamp !== b.timeStamp
      ? a.timeStamp - b.timeStamp
      : (a.id ?? 0) - (b.id ?? 0),
  )
}

export function buildTraceSignature(
  records: readonly IWordRecord[],
): TraceSignature {
  const learn = sortRecords(
    records.filter((record) => record.sourceMode === 'learn'),
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

function traceMetricPairs(
  left: TraceSignature,
  right: TraceSignature,
): Array<{
  name: TraceMetricName
  left: number | null
  right: number | null
  scale: number
}> {
  return [
    {
      name: 'medianFirstKeyLatencyMs',
      left: left.medianFirstKeyLatencyMs,
      right: right.medianFirstKeyLatencyMs,
      scale: 1 / 1500,
    },
    {
      name: 'hintUseRate',
      left: left.hintUseRate,
      right: right.hintUseRate,
      scale: 2,
    },
    {
      name: 'reviewSuccessRate',
      left: left.reviewSuccessRate,
      right: right.reviewSuccessRate,
      scale: 2,
    },
    {
      name: 'acquisitionAttemptsPerAdmittedWord',
      left: left.acquisitionAttemptsPerAdmittedWord,
      right: right.acquisitionAttemptsPerAdmittedWord,
      scale: 0.5,
    },
    {
      name: 'meanDailyInteractions',
      left: left.meanDailyInteractions,
      right: right.meanDailyInteractions,
      scale: 1 / 40,
    },
    {
      name: 'p95DailyInteractions',
      left: left.p95DailyInteractions,
      right: right.p95DailyInteractions,
      scale: 1 / 80,
    },
    {
      name: 'reviewSuccessByGap.le2d',
      left: left.reviewSuccessByGap.le2d,
      right: right.reviewSuccessByGap.le2d,
      scale: 1,
    },
    {
      name: 'reviewSuccessByGap.d2to7',
      left: left.reviewSuccessByGap.d2to7,
      right: right.reviewSuccessByGap.d2to7,
      scale: 1,
    },
    {
      name: 'reviewSuccessByGap.d7to30',
      left: left.reviewSuccessByGap.d7to30,
      right: right.reviewSuccessByGap.d7to30,
      scale: 1,
    },
    {
      name: 'reviewSuccessByGap.gt30d',
      left: left.reviewSuccessByGap.gt30d,
      right: right.reviewSuccessByGap.gt30d,
      scale: 1,
    },
  ]
}

export function compareTraceSignatures(
  left: TraceSignature,
  right: TraceSignature,
): TraceSignatureComparisonV1 {
  const absoluteDeltas: Partial<
    Record<TraceMetricName, number>
  > = {}
  const missingMetrics: TraceMetricName[] = []
  let weightedTotal = 0
  let comparableMetrics = 0

  for (const pair of traceMetricPairs(left, right)) {
    if (pair.left === null || pair.right === null) {
      missingMetrics.push(pair.name)
      continue
    }

    const delta = Math.abs(pair.left - pair.right)
    absoluteDeltas[pair.name] = delta
    weightedTotal += delta * pair.scale
    comparableMetrics += 1
  }

  return {
    distance:
      comparableMetrics === 0
        ? Number.POSITIVE_INFINITY
        : weightedTotal / comparableMetrics,
    comparableMetrics,
    missingMetrics,
    absoluteDeltas,
  }
}

export function traceSignatureDistance(
  left: TraceSignature,
  right: TraceSignature,
): number {
  return compareTraceSignatures(left, right).distance
}

export function buildLearnCalibrationReport(input: {
  records: readonly IWordRecord[]
  generatedAt: number
}): LearnCalibrationReportV1 {
  const learn = input.records.filter(
    (record) => record.sourceMode === 'learn',
  )
  const review = learn.filter(
    (record) => record.learnItemKind === 'review',
  )
  const acquisition = learn.filter(
    (record) => record.learnItemKind === 'acquisition',
  )

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    coverage: {
      sourceRecords: input.records.length,
      learnRecords: learn.length,
      reviewRecords: review.length,
      acquisitionRecords: acquisition.length,
      telemetryRecords: learn.filter(
        (record) => record.typingTelemetry !== undefined,
      ).length,
      hintObservedRecords: learn.filter(
        (record) =>
          record.learningContext?.reviewHint !== undefined,
      ).length,
      ratedReviewRecords: review.filter(
        (record) =>
          record.reviewRatingDecision?.eligible === true &&
          record.reviewRatingDecision.rating !== null &&
          record.reviewRatingDecision.rating !== undefined,
      ).length,
      fsrsShadowRecords: review.filter(
        (record) => record.fsrsShadow !== undefined,
      ).length,
    },
    signature: buildTraceSignature(input.records),
  }
}

export function splitLearnCalibrationRecordsByTime(input: {
  records: readonly IWordRecord[]
  holdoutStartAt: number
}): LearnCalibrationSplit {
  const learn = sortRecords(
    input.records.filter(
      (record) => record.sourceMode === 'learn',
    ),
  )

  return {
    holdoutStartAt: input.holdoutStartAt,
    training: learn.filter(
      (record) => record.timeStamp < input.holdoutStartAt,
    ),
    holdout: learn.filter(
      (record) => record.timeStamp >= input.holdoutStartAt,
    ),
  }
}
