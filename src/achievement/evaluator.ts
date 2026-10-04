import type { AchievementCondition } from '@/resources/achievementCulture'
import type { IWordRecord } from '@/utils/db/record'

const DAY_SECONDS = 86_400

export type AchievementMetricContext = {
  current: IWordRecord
  records: IWordRecord[]
  now: number
}

function isLearnRecord(record: IWordRecord): boolean {
  if (record.sourceMode === 'learn') return true
  if (record.sourceMode === 'typing') return false

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

function isIndependentCorrect(record: IWordRecord): boolean {
  return (
    isPrimaryLearnAttempt(record) &&
    record.wrongCount === 0 &&
    record.learningContext?.reviewHint === undefined &&
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.reviewRatingDecision?.rating !== 'again'
  )
}

function isFailure(record: IWordRecord): boolean {
  if (!isPrimaryLearnAttempt(record)) return false
  return (
    record.wrongCount > 0 ||
    record.reviewRatingDecision?.rating === 'again' ||
    record.reviewEvidence?.memoryGrade === 'again'
  )
}

function recordOrder(left: IWordRecord, right: IWordRecord): number {
  if (left.timeStamp !== right.timeStamp) {
    return left.timeStamp - right.timeStamp
  }
  return (left.id ?? 0) - (right.id ?? 0)
}

function recordsThroughCurrent(context: AchievementMetricContext): IWordRecord[] {
  const currentId = context.current.id ?? Number.MAX_SAFE_INTEGER
  return context.records
    .filter(isPrimaryLearnAttempt)
    .filter(
      (record) =>
        record.timeStamp < context.current.timeStamp ||
        (record.timeStamp === context.current.timeStamp &&
          (record.id ?? 0) <= currentId),
    )
    .sort(recordOrder)
}

function previousSameWordRecords(
  context: AchievementMetricContext,
): IWordRecord[] {
  const currentId = context.current.id
  return recordsThroughCurrent(context).filter(
    (record) =>
      record.dict === context.current.dict &&
      record.word === context.current.word &&
      (currentId === undefined || record.id !== currentId),
  )
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDayWindow(window: string | null | undefined): number | null {
  if (!window) return null
  const match = /^(\d+)d$/.exec(window)
  if (!match) return null
  const days = Number(match[1])
  return Number.isInteger(days) && days > 0 ? days : null
}

function firstIndependentWordCorrect(
  context: AchievementMetricContext,
): number {
  return isIndependentCorrect(context.current) ? 1 : 0
}

function consecutiveIndependentCorrectNoHint(
  context: AchievementMetricContext,
): number {
  const records = recordsThroughCurrent(context)
  let streak = 0

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (!isIndependentCorrect(records[index])) break
    streak += 1
  }

  return streak
}

function priorFailedWordIndependentCorrect(
  context: AchievementMetricContext,
): number {
  if (!isIndependentCorrect(context.current)) return 0
  return previousSameWordRecords(context).some(isFailure) ? 1 : 0
}

function wordIndependentCorrectAfterPriorFailures(
  context: AchievementMetricContext,
): number {
  if (!isIndependentCorrect(context.current)) return 0
  return previousSameWordRecords(context).filter(isFailure).length
}

function repeatedErrorPositionResolved(
  context: AchievementMetricContext,
  condition: AchievementCondition,
): number {
  if (!isIndependentCorrect(context.current)) return 0

  const minimum = Number(
    condition.constraints.samePositionFailuresAtLeast ?? 2,
  )
  const counts = new Map<number, number>()

  for (const record of previousSameWordRecords(context)) {
    for (const [rawPosition, keys] of Object.entries(record.mistakes ?? {})) {
      if (!keys || keys.length === 0) continue
      const position = Number(rawPosition)
      counts.set(position, (counts.get(position) ?? 0) + keys.length)
    }
  }

  return [...counts.values()].filter((count) => count >= minimum).length
}

function independentRecallAfterDays(
  context: AchievementMetricContext,
): number {
  if (!isIndependentCorrect(context.current)) return 0

  const prior = previousSameWordRecords(context)
    .filter(
      (record) =>
        record.reviewRatingDecision?.eligible === true ||
        record.reviewEvidence !== undefined,
    )
    .sort(recordOrder)
  const previous = prior.at(-1)
  if (!previous) return 0

  return Math.max(
    0,
    (context.current.timeStamp - previous.timeStamp) / DAY_SECONDS,
  )
}

function wordSuccessAcrossIncreasingIntervals(
  context: AchievementMetricContext,
): number {
  const records = recordsThroughCurrent(context).filter(
    (record) =>
      record.dict === context.current.dict &&
      record.word === context.current.word,
  )

  let lastActiveAt: number | undefined
  let previousSuccessfulInterval: number | undefined
  let chain = 0

  for (const record of records) {
    const interval =
      lastActiveAt === undefined
        ? undefined
        : Math.max(0, record.timeStamp - lastActiveAt)

    if (isIndependentCorrect(record)) {
      if (interval === undefined) {
        chain = 1
      } else if (
        previousSuccessfulInterval !== undefined &&
        interval > previousSuccessfulInterval
      ) {
        chain += 1
      } else {
        chain = 1
      }
      if (interval !== undefined) {
        previousSuccessfulInterval = interval
      }
    } else {
      chain = 0
      previousSuccessfulInterval = undefined
    }

    lastActiveAt = record.timeStamp
  }

  return isIndependentCorrect(context.current) ? chain : 0
}

function activeLearnDaysInWindow(
  context: AchievementMetricContext,
  condition: AchievementCondition,
): number | null {
  const days = parseDayWindow(condition.window)
  if (days === null) return null

  const current = new Date(context.now * 1000)
  current.setHours(0, 0, 0, 0)
  current.setDate(current.getDate() - (days - 1))
  const start = Math.floor(current.getTime() / 1000)

  return new Set(
    recordsThroughCurrent(context)
      .filter((record) => record.timeStamp >= start)
      .map((record) => localDateKey(record.timeStamp)),
  ).size
}

function sameWordDistinctErrorPositionsResolved(
  context: AchievementMetricContext,
): number {
  if (!isIndependentCorrect(context.current)) return 0

  const positions = new Set<number>()
  for (const record of previousSameWordRecords(context)) {
    for (const [rawPosition, keys] of Object.entries(record.mistakes ?? {})) {
      if (keys && keys.length > 0) positions.add(Number(rawPosition))
    }
  }
  return positions.size
}

export const SUPPORTED_WORD_METRICS = new Set([
  'first_independent_word_correct',
  'consecutive_independent_correct_no_hint',
  'prior_failed_word_independent_correct',
  'word_independent_correct_after_prior_failures',
  'repeated_error_position_resolved',
  'independent_recall_after_days',
  'word_success_across_increasing_intervals',
  'active_learn_days_in_window',
  'same_word_distinct_error_positions_resolved',
])

export function evaluateWordMetric(
  condition: AchievementCondition,
  context: AchievementMetricContext,
): number | null {
  switch (condition.metric) {
    case 'first_independent_word_correct':
      return firstIndependentWordCorrect(context)
    case 'consecutive_independent_correct_no_hint':
      return consecutiveIndependentCorrectNoHint(context)
    case 'prior_failed_word_independent_correct':
      return priorFailedWordIndependentCorrect(context)
    case 'word_independent_correct_after_prior_failures':
      return wordIndependentCorrectAfterPriorFailures(context)
    case 'repeated_error_position_resolved':
      return repeatedErrorPositionResolved(context, condition)
    case 'independent_recall_after_days':
      return independentRecallAfterDays(context)
    case 'word_success_across_increasing_intervals':
      return wordSuccessAcrossIncreasingIntervals(context)
    case 'active_learn_days_in_window':
      return activeLearnDaysInWindow(context, condition)
    case 'same_word_distinct_error_positions_resolved':
      return sameWordDistinctErrorPositionsResolved(context)
    default:
      return null
  }
}

export function evaluatePreviousWordMetric(
  condition: AchievementCondition,
  context: AchievementMetricContext,
): number | null {
  const currentId = context.current.id
  const previous = recordsThroughCurrent(context)
    .filter(
      (record) =>
        currentId === undefined ||
        record.id !== currentId,
    )
    .at(-1)

  if (!previous) return null

  return evaluateWordMetric(condition, {
    current: previous,
    records: context.records,
    now: previous.timeStamp,
  })
}

export function conditionSatisfied(
  condition: AchievementCondition,
  value: number,
): boolean {
  switch (condition.operator) {
    case 'gte':
      return value >= condition.target
    case 'lte':
      return value <= condition.target
    case 'eq':
      return value === condition.target
    case 'gt':
      return value > condition.target
    case 'lt':
      return value < condition.target
  }
}
