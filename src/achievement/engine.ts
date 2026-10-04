import {
  achievementDefinitions,
  type AchievementDefinition,
} from '@/resources/achievementCulture'
import { db } from '@/utils/db'
import {
  conditionSatisfied,
  evaluateWordMetric,
  SUPPORTED_WORD_METRICS,
} from './evaluator'
import type {
  AchievementEventRecord,
  AchievementStateRecord,
  AchievementUnlock,
} from './types'

function isLiveLearnRecord(record: {
  sourceMode?: 'typing' | 'learn'
}): boolean {
  return record.sourceMode === 'learn'
}

function p0WordAchievements(): AchievementDefinition[] {
  return achievementDefinitions.filter(
    (achievement) =>
      achievement.enabled &&
      achievement.presentation.rollout === 'p0' &&
      SUPPORTED_WORD_METRICS.has(achievement.condition.metric),
  )
}

/**
 * Processes exactly one newly persisted Learn WordRecord.
 *
 * This is intentionally live-only. There is no history replay path here:
 * imported/restored WordRecords must not retroactively mint achievements.
 * Historical records are read only as evidence for a new live event.
 */
export async function processLiveLearnWordRecord(
  sourceRecordId: number,
): Promise<AchievementUnlock[]> {
  if (!Number.isInteger(sourceRecordId) || sourceRecordId <= 0) return []

  const eventId = `word:${sourceRecordId}`
  const alreadyProcessed = await db.achievementEvents.get(eventId)
  if (alreadyProcessed) return []

  const current = await db.wordRecords.get(sourceRecordId)
  if (!current || !isLiveLearnRecord(current)) return []

  // User-window metrics span dictionaries; word-scoped evaluators explicitly
  // isolate current dict+word so cross-library homographs cannot leak state.
  const records = await db.wordRecords.toArray()

  const values = new Map<string, number>()
  const candidates: Array<{
    achievement: AchievementDefinition
    value: number
  }> = []

  for (const achievement of p0WordAchievements()) {
    const value = evaluateWordMetric(achievement.condition, {
      current,
      records,
      now: current.timeStamp,
    })
    if (value === null) continue
    values.set(achievement.condition.metric, value)
    if (conditionSatisfied(achievement.condition, value)) {
      candidates.push({ achievement, value })
    }
  }

  return db.transaction(
    'rw',
    db.achievementEvents,
    db.achievementStates,
    async () => {
      const duplicate = await db.achievementEvents.get(eventId)
      if (duplicate) return []

      const unlocks: AchievementUnlock[] = []
      const unlockedAchievementIds: string[] = []

      for (const candidate of candidates) {
        const existing = await db.achievementStates.get(
          candidate.achievement.id,
        )
        if (existing) continue

        const state: AchievementStateRecord = {
          achievementId: candidate.achievement.id,
          unlockedAt: current.timeStamp,
          firstTriggerEventId: eventId,
          sourceRecordId,
        }

        await db.achievementStates.add(state)
        unlockedAchievementIds.push(candidate.achievement.id)
        unlocks.push({
          achievement: candidate.achievement,
          state,
          metricValue: candidate.value,
        })
      }

      const event: AchievementEventRecord = {
        eventId,
        eventType: 'word_attempt',
        origin: 'live',
        sourceRecordId,
        occurredAt: current.timeStamp,
        dict: current.dict,
        word: current.word,
        metricValues: Object.fromEntries(values),
        unlockedAchievementIds,
      }
      await db.achievementEvents.add(event)

      return unlocks
    },
  )
}
