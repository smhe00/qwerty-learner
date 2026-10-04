import type { AchievementCondition } from '@/resources/achievementCulture'
import type { IWordRecord } from '@/utils/db/record'

export type AchievementSessionMetricContext = {
  records: IWordRecord[]
}

function isLearnRecord(record: IWordRecord): boolean {
  return record.sourceMode === 'learn'
}

function orderedRecords(
  context: AchievementSessionMetricContext,
): IWordRecord[] {
  return context.records
    .filter(isLearnRecord)
    .sort((left, right) => {
      if (left.timeStamp !== right.timeStamp) {
        return left.timeStamp - right.timeStamp
      }
      return (left.id ?? 0) - (right.id ?? 0)
    })
}

function isIndependentCompletion(record: IWordRecord): boolean {
  return (
    record.learningContext?.reviewHint === undefined &&
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.typingTelemetry?.attempts.at(-1)?.result === 'clean'
  )
}

function sessionSecondHalfAccuracyGainPp(
  condition: AchievementCondition,
  context: AchievementSessionMetricContext,
): number | null {
  const minimum = Number(condition.constraints.minWords ?? 0)
  const scorable = orderedRecords(context).filter(
    (record) => record.typingTelemetry?.attempts.at(-1)?.result === 'clean',
  )
  if (scorable.length < minimum) return null

  const half = Math.floor(scorable.length / 2)
  if (half === 0) return null

  const first = scorable.slice(0, half)
  const second = scorable.slice(scorable.length - half)
  const rate = (records: IWordRecord[]) =>
    (records.filter((record) => record.wrongCount === 0).length /
      records.length) *
    100

  return rate(second) - rate(first)
}

function recoverAfterConsecutiveErrors(
  context: AchievementSessionMetricContext,
): number {
  let consecutiveErrors = 0
  let bestRecoveredRun = 0

  for (const record of orderedRecords(context)) {
    const attempts = record.typingTelemetry?.attempts ?? []

    for (const attempt of attempts) {
      if (attempt.result === 'wrong') {
        consecutiveErrors += 1
        continue
      }

      if (
        attempt.result === 'clean' &&
        isIndependentCompletion(record) &&
        consecutiveErrors > 0
      ) {
        bestRecoveredRun = Math.max(bestRecoveredRun, consecutiveErrors)
      }
      consecutiveErrors = 0
    }
  }

  return bestRecoveredRun
}

function sameSessionFailThenIndependentRecovery(
  context: AchievementSessionMetricContext,
): number {
  const failuresByWord = new Map<string, number>()
  let bestRecovery = 0

  for (const record of orderedRecords(context)) {
    const key = `${record.dict}\u0000${record.word}`
    let failures = failuresByWord.get(key) ?? 0

    // Seeing a Hint contaminates earlier failures for this achievement.
    // A later unaided recovery has to build a fresh no-Hint chain.
    if (record.learningContext?.reviewHint !== undefined) {
      failuresByWord.set(key, 0)
      continue
    }

    for (const attempt of record.typingTelemetry?.attempts ?? []) {
      if (attempt.result === 'wrong') {
        failures += 1
        continue
      }

      if (
        attempt.result === 'clean' &&
        isIndependentCompletion(record) &&
        failures > 0
      ) {
        bestRecovery = Math.max(bestRecovery, failures)
      }
      failures = 0
    }

    failuresByWord.set(key, failures)
  }

  return bestRecovery
}

export const SUPPORTED_SESSION_METRICS = new Set([
  'session_second_half_accuracy_gain_pp',
  'recover_after_consecutive_errors',
  'same_session_fail_then_independent_recovery',
])

export function evaluateSessionMetric(
  condition: AchievementCondition,
  context: AchievementSessionMetricContext,
): number | null {
  switch (condition.metric) {
    case 'session_second_half_accuracy_gain_pp':
      return sessionSecondHalfAccuracyGainPp(condition, context)
    case 'recover_after_consecutive_errors':
      return recoverAfterConsecutiveErrors(context)
    case 'same_session_fail_then_independent_recovery':
      return sameSessionFailThenIndependentRecovery(context)
    default:
      return null
  }
}
