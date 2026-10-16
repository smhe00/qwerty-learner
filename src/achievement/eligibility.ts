/**
 * Evidence gates for rare achievements. A threshold only counts when
 * meaningful, distinct Learn evidence is present. This is not a cooldown:
 * a qualifying learner earns the badge immediately, and pre-existing badges
 * are never revoked when a condition is recalibrated.
 */
import { buildAchievementUnitMembership } from './unit-evaluator'
import type { AchievementCondition } from '@/resources/achievementCulture'
import type { IWordRecord } from '@/utils/db/record'
import type { Word } from '@/typings'
import type { AchievementEventRecord } from './types'

function isIndependentLearnSuccess(record: IWordRecord): boolean {
  return record.sourceMode === 'learn' &&
    record.wrongCount === 0 &&
    record.learningContext?.reviewHint === undefined &&
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.reviewRatingDecision?.rating !== 'again' &&
    record.reviewRatingDecision?.eligible !== false
}

/** Natural local study day, matching the Learn daily session contract. */
export function achievementLocalDay(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function achievementEvidenceSatisfied(
  condition: AchievementCondition,
  records: IWordRecord[],
  dictionaryWords: Word[] = [],
): boolean {
  const constraints = condition.constraints
  const learn = records.filter((record) => record.sourceMode === 'learn')

  if (typeof constraints.minActiveDays === 'number') {
    const days = new Set(learn.map((record) => achievementLocalDay(record.timeStamp)))
    if (days.size < constraints.minActiveDays) return false
  }

  if (typeof constraints.minIndependentUniqueWords === 'number') {
    const words = new Set(
      learn.filter(isIndependentLearnSuccess)
        .map((record) => JSON.stringify([record.dict, record.word])),
    )
    if (words.size < constraints.minIndependentUniqueWords) return false
  }

  if (typeof constraints.minRecoveredUniqueWords === 'number') {
    const failed = new Set<string>()
    const recovered = new Set<string>()
    const sorted = [...learn].sort((a, b) =>
      a.timeStamp - b.timeStamp || (a.id ?? 0) - (b.id ?? 0))
    for (const record of sorted) {
      const key = JSON.stringify([record.dict, record.word])
      if (isIndependentLearnSuccess(record) && failed.has(key)) recovered.add(key)
      if (record.wrongCount > 0 ||
          record.reviewRatingDecision?.rating === 'again' ||
          record.reviewEvidence?.memoryGrade === 'again') failed.add(key)
    }
    if (recovered.size < constraints.minRecoveredUniqueWords) return false
  }

  if (typeof constraints.minStartedUnits === 'number') {
    const membership = buildAchievementUnitMembership(dictionaryWords)
    const units = new Set(
      learn.filter((record) => membership.has(record.word))
        .map((record) => membership.get(record.word)!.unitIndex),
    )
    if (units.size < constraints.minStartedUnits) return false
  }

  return true
}

export function countEvidenceDays(
  events: AchievementEventRecord[],
  metric: string,
  happenedAt: number,
  qualifiesNow: boolean,
): number {
  const days = new Set(events
    .filter((event) => event.origin === 'live' &&
      (event.metricValues[metric] ?? 0) > 0)
    .map((event) => achievementLocalDay(event.occurredAt)))
  if (qualifiesNow) days.add(achievementLocalDay(happenedAt))
  return days.size
}
