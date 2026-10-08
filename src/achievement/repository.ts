import { db } from '@/utils/db/core'
import type { AchievementStateRecord } from './types'

export async function getAchievementStates(): Promise<
  AchievementStateRecord[]
> {
  return db.achievementStates.orderBy('unlockedAt').toArray()
}

export async function getAchievementState(
  achievementId: string,
): Promise<AchievementStateRecord | undefined> {
  return db.achievementStates.get(achievementId)
}

export async function markAchievementSeen(
  achievementId: string,
  seenAt = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db.achievementStates.update(achievementId, { seenAt })
}

export async function markAchievementCultureCardSeen(
  achievementId: string,
  cultureCardSeenAt = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db.achievementStates.update(achievementId, { cultureCardSeenAt })
}

export async function getUnseenAchievementStates(): Promise<
  AchievementStateRecord[]
> {
  return db.achievementStates
    .filter((state) => state.seenAt === undefined)
    .sortBy('unlockedAt')
}
