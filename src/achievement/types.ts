import type { AchievementDefinition } from '@/resources/achievementCulture'

export type AchievementEventOrigin = 'live'

export interface AchievementEventRecord {
  eventId: string
  eventType:
    | 'word_attempt'
    | 'session_completed'
    | 'word_mastered'
    | 'continue_intent'
    | 'unlock_queue'
  origin: AchievementEventOrigin
  sourceRecordId?: number
  sourceRecordIds?: number[]
  sessionId?: string
  occurredAt: number
  dict: string
  word?: string
  metricValues: Record<string, number>
  unlockedAchievementIds: string[]
  /** Durable delayed grants; stored only on the unique unlock_queue event. */
  pendingAwards?: PendingAchievementAward[]
}

export interface PendingAchievementAward {
  achievementId: string
  firstTriggerEventId: string
  triggeredAt: number
  metricValue: number
  sourceRecordId?: number
  sessionId?: string
}

export interface AchievementStateRecord {
  achievementId: string
  unlockedAt: number
  firstTriggerEventId: string
  sourceRecordId?: number
  sessionId?: string
  seenAt?: number
  cultureCardSeenAt?: number
}

export interface AchievementUnlock {
  achievement: AchievementDefinition
  state: AchievementStateRecord
  metricValue: number
}

export type MetricConstraints = Record<string, string | number | boolean>
