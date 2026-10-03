import {
  FSRS_SHADOW_ALGORITHM_MODEL,
  FSRS_SHADOW_LIBRARY_VERSION,
  FSRS_SHADOW_PARAMETER_SET_ID,
  FSRS_SHADOW_SCHEMA_VERSION,
} from './types'
import type { FsrsLiveShadowObservationV1 } from './types'
import type { ReviewOutcome } from '../types'

const DAY_SECONDS = 86_400

export const G3_DESCRIPTIVE_MIN_SAMPLES = 50 as const
export const G3_G4_REVIEW_MIN_SAMPLES = 200 as const
export const G3_G4_REVIEW_MIN_CLASS_SAMPLES = 20 as const

export type FsrsG3Readiness =
  | 'collecting'
  | 'descriptive'
  | 'g4-review-ready'

export type FsrsCalibrationBucketV1 = {
  lowerInclusive: number
  upperInclusive: number
  samples: number
  remembered: number
  observedRecallRate: number | null
  meanPredictedRetrievability: number | null
  absoluteCalibrationError: number | null
}

export type FsrsCalibrationSummaryV1 = {
  usableSamples: number
  rememberedSamples: number
  forgottenSamples: number
  brierScore: number | null
  expectedCalibrationError: number | null
  buckets: FsrsCalibrationBucketV1[]
}

export type FsrsDiscriminationSummaryV1 = {
  usableSamples: number
  rememberedSamples: number
  forgottenSamples: number
  meanRetrievabilityRemembered: number | null
  meanRetrievabilityForgotten: number | null
  auc: number | null
}

export type FsrsIntervalPercentilesV1 = {
  p50: number | null
  p90: number | null
  p95: number | null
  max: number | null
}

export type FsrsIntervalOutlierV1 = {
  dict: string
  word: string
  sourceRecordId?: number
  eventTime: number
  rating: ReviewOutcome
  retrievabilityBefore: number | null
  basicIntervalDays: number
  fsrsIntervalDays: number
  fsrsToBasicRatio: number
}

export type FsrsIntervalDivergenceSummaryV1 = {
  comparableSamples: number
  ratio: FsrsIntervalPercentilesV1
  absoluteDifferenceDays: FsrsIntervalPercentilesV1
  shorterThanQuarterBasic: number
  longerThanFourTimesBasic: number
  outliers: FsrsIntervalOutlierV1[]
}

export type FsrsWorkloadHorizonV1 = {
  days: 1 | 7 | 30
  basicDueWords: number
  fsrsDueWords: number
  deltaWords: number
}

export type FsrsWorkloadSummaryV1 = {
  asOf: number
  latestShadowWords: number
  basicOverdueNow: number
  fsrsOverdueNow: number
  horizons: FsrsWorkloadHorizonV1[]
}

export type FsrsAnalysisRecordV1 = {
  id?: number
  dict: string
  word: string
  sourceMode?: 'typing' | 'learn'
  learnItemKind?: 'review' | 'acquisition'
  reviewRatingDecision?: {
    eligible: boolean
  }
  fsrsShadow?: FsrsLiveShadowObservationV1
}

export type FsrsG3AnalysisV1 = {
  schemaVersion: 1
  libraryVersion: typeof FSRS_SHADOW_LIBRARY_VERSION
  algorithmModel: typeof FSRS_SHADOW_ALGORITHM_MODEL
  parameterSetId: typeof FSRS_SHADOW_PARAMETER_SET_ID
  shadowSchemaVersion: typeof FSRS_SHADOW_SCHEMA_VERSION
  readiness: FsrsG3Readiness
  totalShadowRecords: number
  homogeneousShadowRecords: number
  rejectedShadowRecords: number
  calibration: FsrsCalibrationSummaryV1
  discrimination: FsrsDiscriminationSummaryV1
  intervalDivergence: FsrsIntervalDivergenceSummaryV1
  workload: FsrsWorkloadSummaryV1
}

type HomogeneousSample = {
  record: FsrsAnalysisRecordV1
  shadow: FsrsLiveShadowObservationV1
}

const calibrationRanges = [
  [0, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1],
] as const

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return round6(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * q
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  if (lower === undefined || upper === undefined) return null
  if (lowerIndex === upperIndex) return round6(lower)

  const weight = position - lowerIndex
  return round6(lower + (upper - lower) * weight)
}

function percentiles(values: readonly number[]): FsrsIntervalPercentilesV1 {
  if (values.length === 0) {
    return { p50: null, p90: null, p95: null, max: null }
  }

  return {
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: round6(Math.max(...values)),
  }
}

function isRemembered(rating: ReviewOutcome): boolean {
  return rating !== 'again'
}

function hasCurrentProvenance(
  shadow: FsrsLiveShadowObservationV1,
): boolean {
  return (
    shadow.schemaVersion === FSRS_SHADOW_SCHEMA_VERSION &&
    shadow.libraryVersion === FSRS_SHADOW_LIBRARY_VERSION &&
    shadow.algorithmModel === FSRS_SHADOW_ALGORITHM_MODEL &&
    shadow.parameterSetId === FSRS_SHADOW_PARAMETER_SET_ID
  )
}

function collectHomogeneousSamples(
  records: readonly FsrsAnalysisRecordV1[],
): {
  totalShadowRecords: number
  homogeneous: HomogeneousSample[]
} {
  let totalShadowRecords = 0
  const homogeneous: HomogeneousSample[] = []

  for (const record of records) {
    if (!record.fsrsShadow) continue
    totalShadowRecords += 1

    if (
      record.sourceMode === 'typing' ||
      record.learnItemKind === 'acquisition' ||
      record.reviewRatingDecision?.eligible !== true ||
      !hasCurrentProvenance(record.fsrsShadow)
    ) {
      continue
    }

    if (
      record.id !== undefined &&
      record.fsrsShadow.sourceRecordId !== undefined &&
      record.fsrsShadow.sourceRecordId !== record.id
    ) {
      continue
    }

    homogeneous.push({ record, shadow: record.fsrsShadow })
  }

  return { totalShadowRecords, homogeneous }
}

function buildCalibration(
  samples: readonly HomogeneousSample[],
): FsrsCalibrationSummaryV1 {
  const usable = samples.filter(({ shadow }) => {
    const r = shadow.retrievabilityBefore
    return r !== null && Number.isFinite(r) && r >= 0 && r <= 1
  })

  const rememberedSamples = usable.filter(({ shadow }) =>
    isRemembered(shadow.rating),
  ).length
  const forgottenSamples = usable.length - rememberedSamples

  const brierValues = usable.map(({ shadow }) => {
    const predicted = shadow.retrievabilityBefore as number
    const actual = isRemembered(shadow.rating) ? 1 : 0
    return (predicted - actual) ** 2
  })

  const buckets = calibrationRanges.map(
    ([lowerInclusive, upperInclusive], index): FsrsCalibrationBucketV1 => {
      const isLast = index === calibrationRanges.length - 1
      const bucketSamples = usable.filter(({ shadow }) => {
        const r = shadow.retrievabilityBefore as number
        return (
          r >= lowerInclusive &&
          (isLast ? r <= upperInclusive : r < upperInclusive)
        )
      })
      const remembered = bucketSamples.filter(({ shadow }) =>
        isRemembered(shadow.rating),
      ).length
      const observedRecallRate =
        bucketSamples.length === 0
          ? null
          : round6(remembered / bucketSamples.length)
      const meanPredictedRetrievability = mean(
        bucketSamples.map(
          ({ shadow }) => shadow.retrievabilityBefore as number,
        ),
      )

      return {
        lowerInclusive,
        upperInclusive,
        samples: bucketSamples.length,
        remembered,
        observedRecallRate,
        meanPredictedRetrievability,
        absoluteCalibrationError:
          observedRecallRate === null ||
          meanPredictedRetrievability === null
            ? null
            : round6(
                Math.abs(
                  observedRecallRate - meanPredictedRetrievability,
                ),
              ),
      }
    },
  )

  const expectedCalibrationError =
    usable.length === 0
      ? null
      : round6(
          buckets.reduce((sum, bucket) => {
            if (bucket.absoluteCalibrationError === null) return sum
            return (
              sum +
              bucket.absoluteCalibrationError *
                (bucket.samples / usable.length)
            )
          }, 0),
        )

  return {
    usableSamples: usable.length,
    rememberedSamples,
    forgottenSamples,
    brierScore: mean(brierValues),
    expectedCalibrationError,
    buckets,
  }
}

function buildDiscrimination(
  samples: readonly HomogeneousSample[],
): FsrsDiscriminationSummaryV1 {
  const usable = samples.filter(
    ({ shadow }) => shadow.retrievabilityBefore !== null,
  )
  const remembered = usable.filter(({ shadow }) =>
    isRemembered(shadow.rating),
  )
  const forgotten = usable.filter(
    ({ shadow }) => !isRemembered(shadow.rating),
  )
  const rememberedR = remembered.map(
    ({ shadow }) => shadow.retrievabilityBefore as number,
  )
  const forgottenR = forgotten.map(
    ({ shadow }) => shadow.retrievabilityBefore as number,
  )

  let auc: number | null = null
  if (rememberedR.length > 0 && forgottenR.length > 0) {
    let score = 0
    let pairs = 0
    for (const positive of rememberedR) {
      for (const negative of forgottenR) {
        pairs += 1
        if (positive > negative) score += 1
        else if (positive === negative) score += 0.5
      }
    }
    auc = round6(score / pairs)
  }

  return {
    usableSamples: usable.length,
    rememberedSamples: remembered.length,
    forgottenSamples: forgotten.length,
    meanRetrievabilityRemembered: mean(rememberedR),
    meanRetrievabilityForgotten: mean(forgottenR),
    auc,
  }
}

function buildIntervalDivergence(
  samples: readonly HomogeneousSample[],
): FsrsIntervalDivergenceSummaryV1 {
  const comparable = samples
    .filter(
      ({ shadow }) =>
        Number.isFinite(shadow.basicV2.nominalIntervalDays) &&
        shadow.basicV2.nominalIntervalDays > 0 &&
        Number.isFinite(shadow.selectedIntervalDays) &&
        shadow.selectedIntervalDays >= 0,
    )
    .map(({ record, shadow }) => {
      const basic = shadow.basicV2.nominalIntervalDays
      const fsrs = shadow.selectedIntervalDays
      return {
        record,
        shadow,
        ratio: fsrs / basic,
        difference: fsrs - basic,
      }
    })

  const outliers = comparable
    .filter(({ ratio }) => ratio <= 0.25 || ratio >= 4)
    .map(
      ({ record, shadow, ratio }): FsrsIntervalOutlierV1 => ({
        dict: record.dict,
        word: record.word,
        sourceRecordId: record.id,
        eventTime: shadow.eventTime,
        rating: shadow.rating,
        retrievabilityBefore: shadow.retrievabilityBefore,
        basicIntervalDays: shadow.basicV2.nominalIntervalDays,
        fsrsIntervalDays: shadow.selectedIntervalDays,
        fsrsToBasicRatio: round6(ratio),
      }),
    )
    .sort(
      (left, right) =>
        Math.abs(Math.log(right.fsrsToBasicRatio || Number.MIN_VALUE)) -
        Math.abs(Math.log(left.fsrsToBasicRatio || Number.MIN_VALUE)),
    )

  return {
    comparableSamples: comparable.length,
    ratio: percentiles(comparable.map(({ ratio }) => ratio)),
    absoluteDifferenceDays: percentiles(
      comparable.map(({ difference }) => Math.abs(difference)),
    ),
    shorterThanQuarterBasic: comparable.filter(
      ({ ratio }) => ratio <= 0.25,
    ).length,
    longerThanFourTimesBasic: comparable.filter(
      ({ ratio }) => ratio >= 4,
    ).length,
    outliers,
  }
}

function buildWorkload(
  samples: readonly HomogeneousSample[],
  asOf: number,
): FsrsWorkloadSummaryV1 {
  const latestByWord = new Map<string, HomogeneousSample>()

  for (const sample of samples) {
    const key = `${sample.record.dict}\u0000${sample.record.word}`
    const current = latestByWord.get(key)
    if (
      !current ||
      sample.shadow.eventTime > current.shadow.eventTime ||
      (sample.shadow.eventTime === current.shadow.eventTime &&
        (sample.record.id ?? -1) > (current.record.id ?? -1))
    ) {
      latestByWord.set(key, sample)
    }
  }

  const latest = [...latestByWord.values()]
  const countDue = (
    selector: (sample: HomogeneousSample) => number,
    cutoff: number,
  ) => latest.filter((sample) => selector(sample) <= cutoff).length

  const basicDue = (sample: HomogeneousSample) =>
    sample.shadow.basicV2.dueAt
  const fsrsDue = (sample: HomogeneousSample) => sample.shadow.after.dueAt

  const horizons = ([1, 7, 30] as const).map((days) => {
    const cutoff = asOf + days * DAY_SECONDS
    const basicDueWords = countDue(basicDue, cutoff)
    const fsrsDueWords = countDue(fsrsDue, cutoff)
    return {
      days,
      basicDueWords,
      fsrsDueWords,
      deltaWords: fsrsDueWords - basicDueWords,
    }
  })

  return {
    asOf,
    latestShadowWords: latest.length,
    basicOverdueNow: countDue(basicDue, asOf),
    fsrsOverdueNow: countDue(fsrsDue, asOf),
    horizons,
  }
}

function decideReadiness(
  calibration: FsrsCalibrationSummaryV1,
): FsrsG3Readiness {
  if (
    calibration.usableSamples >= G3_G4_REVIEW_MIN_SAMPLES &&
    calibration.rememberedSamples >= G3_G4_REVIEW_MIN_CLASS_SAMPLES &&
    calibration.forgottenSamples >= G3_G4_REVIEW_MIN_CLASS_SAMPLES
  ) {
    return 'g4-review-ready'
  }

  if (calibration.usableSamples >= G3_DESCRIPTIVE_MIN_SAMPLES) {
    return 'descriptive'
  }

  return 'collecting'
}

export function analyzeFsrsShadowRecords(input: {
  records: readonly FsrsAnalysisRecordV1[]
  asOf: number
}): FsrsG3AnalysisV1 {
  const { totalShadowRecords, homogeneous } =
    collectHomogeneousSamples(input.records)
  const calibration = buildCalibration(homogeneous)

  return {
    schemaVersion: 1,
    libraryVersion: FSRS_SHADOW_LIBRARY_VERSION,
    algorithmModel: FSRS_SHADOW_ALGORITHM_MODEL,
    parameterSetId: FSRS_SHADOW_PARAMETER_SET_ID,
    shadowSchemaVersion: FSRS_SHADOW_SCHEMA_VERSION,
    readiness: decideReadiness(calibration),
    totalShadowRecords,
    homogeneousShadowRecords: homogeneous.length,
    rejectedShadowRecords: totalShadowRecords - homogeneous.length,
    calibration,
    discrimination: buildDiscrimination(homogeneous),
    intervalDivergence: buildIntervalDivergence(homogeneous),
    workload: buildWorkload(homogeneous, input.asOf),
  }
}
