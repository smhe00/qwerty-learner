import {
  type AchievementDefinition,
  achievementDefinitions,
} from '@/resources/achievementCulture'
import { db } from '@/utils/db'
import {
  SUPPORTED_WORD_METRICS,
  conditionSatisfied,
  evaluatePreviousWordMetric,
  evaluateWordMetric,
} from './evaluator'
import {
  SUPPORTED_SESSION_METRICS,
  evaluateSessionMetric,
} from './session-evaluator'
import type {
  AchievementEventRecord,
  AchievementStateRecord,
  AchievementUnlock,
} from './types'

type AchievementCandidate = {
  achievement: AchievementDefinition
  value: number
}

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

function p0SessionAchievements(): AchievementDefinition[] {
  return achievementDefinitions.filter(
    (achievement) =>
      achievement.enabled &&
      achievement.presentation.rollout === 'p0' &&
      SUPPORTED_SESSION_METRICS.has(achievement.condition.metric),
  )
}

async function persistEventAndUnlocks(
  event: AchievementEventRecord,
  candidates: AchievementCandidate[],
): Promise<AchievementUnlock[]> {
  return db.transaction(
    'rw',
    db.achievementEvents,
    db.achievementStates,
    async () => {
      const duplicate = await db.achievementEvents.get(event.eventId)
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
          unlockedAt: event.occurredAt,
          firstTriggerEventId: event.eventId,
          sourceRecordId:
            event.sourceRecordId ?? event.sourceRecordIds?.at(-1),
          sessionId: event.sessionId,
        }

        await db.achievementStates.add(state)
        unlockedAchievementIds.push(candidate.achievement.id)
        unlocks.push({
          achievement: candidate.achievement,
          state,
          metricValue: candidate.value,
        })
      }

      await db.achievementEvents.add({
        ...event,
        unlockedAchievementIds,
      })

      return unlocks
    },
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
  options: { sessionId?: string } = {},
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
  const candidates: AchievementCandidate[] = []

  for (const achievement of p0WordAchievements()) {
    const value = evaluateWordMetric(achievement.condition, {
      current,
      records,
      now: current.timeStamp,
    })
    if (value === null) continue
    values.set(achievement.condition.metric, value)

    const previousValue = evaluatePreviousWordMetric(
      achievement.condition,
      {
        current,
        records,
        now: current.timeStamp,
      },
    )
    const crossedThreshold =
      conditionSatisfied(achievement.condition, value) &&
      (previousValue === null ||
        !conditionSatisfied(achievement.condition, previousValue))

    if (crossedThreshold) {
      candidates.push({ achievement, value })
    }
  }

  const event: AchievementEventRecord = {
    eventId,
    eventType: 'word_attempt',
    origin: 'live',
    sourceRecordId,
    sessionId: options.sessionId,
    occurredAt: current.timeStamp,
    dict: current.dict,
    word: current.word,
    metricValues: Object.fromEntries(values),
    unlockedAchievementIds: [],
  }

  return persistEventAndUnlocks(event, candidates)
}

export async function processLiveLearnSessionCompletion(input: {
  sessionId: string
  dict: string
  sourceRecordIds: number[]
  completedAt: number
}): Promise<AchievementUnlock[]> {
  if (!input.sessionId || input.sourceRecordIds.length === 0) return []

  const eventId = `session:${input.sessionId}:completed`
  const alreadyProcessed = await db.achievementEvents.get(eventId)
  if (alreadyProcessed) return []

  const sourceRecordIds = [...new Set(input.sourceRecordIds)].filter(
    (id) => Number.isInteger(id) && id > 0,
  )
  if (sourceRecordIds.length === 0) return []

  const records = (
    await db.wordRecords.bulkGet(sourceRecordIds)
  ).filter(
    (record): record is NonNullable<typeof record> =>
      record !== undefined && isLiveLearnRecord(record),
  )
  if (records.length === 0) return []

  const values = new Map<string, number>()
  const candidates: AchievementCandidate[] = []

  for (const achievement of p0SessionAchievements()) {
    const value = evaluateSessionMetric(achievement.condition, { records })
    if (value === null) continue
    values.set(achievement.condition.metric, value)
    if (conditionSatisfied(achievement.condition, value)) {
      candidates.push({ achievement, value })
    }
  }

  const event: AchievementEventRecord = {
    eventId,
    eventType: 'session_completed',
    origin: 'live',
    sourceRecordIds,
    sessionId: input.sessionId,
    occurredAt: input.completedAt,
    dict: input.dict,
    metricValues: Object.fromEntries(values),
    unlockedAchievementIds: [],
  }

  return persistEventAndUnlocks(event, candidates)
}
