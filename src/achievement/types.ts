import type { AchievementDefinition } from '@/resources/achievementCulture'

export type AchievementEventOrigin = 'live'

export interface AchievementEventRecord {
  eventId: string
  eventType: 'word_attempt' | 'session_completed' | 'word_mastered'
  origin: AchievementEventOrigin
  sourceRecordId?: number
  sourceRecordIds?: number[]
  sessionId?: string
  occurredAt: number
  dict: string
  word?: string
  metricValues: Record<string, number>
  unlockedAchievementIds: string[]
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
