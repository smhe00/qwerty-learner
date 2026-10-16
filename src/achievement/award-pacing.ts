import { achievementById } from '@/resources/achievementCulture'
import { achievementLocalDay } from './eligibility'
import type { AchievementStateRecord, PendingAchievementAward } from './types'

const rarityPriority = { common: 0, rare: 1, epic: 2, legendary: 3 } as const

/**
 * At most one new permanent achievement per local calendar day.
 * Earned evidence is queued durably in the existing V4 achievementEvents
 * table, never silently dropped when several milestones coincide.
 */
export function planAchievementAwards(input: {
  now: number
  unlockedStates: AchievementStateRecord[]
  pending: PendingAchievementAward[]
  newlyQualified: PendingAchievementAward[]
}): { awarded: PendingAchievementAward | null; waiting: PendingAchievementAward[] } {
  const alreadyUnlocked = new Set(input.unlockedStates.map(s => s.achievementId))
  const unique = new Map<string, PendingAchievementAward>()
  for (const award of [...input.pending, ...input.newlyQualified]) {
    if (alreadyUnlocked.has(award.achievementId)) continue
    const definition = achievementById.get(award.achievementId)
    if (!definition?.enabled || definition.presentation.rollout !== 'p0') continue
    if (!unique.has(award.achievementId)) unique.set(award.achievementId, award)
  }
  const waiting = [...unique.values()].sort((a, b) => {
    const ra = rarityPriority[achievementById.get(a.achievementId)!.rarity]
    const rb = rarityPriority[achievementById.get(b.achievementId)!.rarity]
    return rb - ra || a.triggeredAt - b.triggeredAt ||
      a.achievementId.localeCompare(b.achievementId)
  })

  const today = achievementLocalDay(input.now)
  const grantedToday = input.unlockedStates.some(
    (state) => achievementLocalDay(state.unlockedAt) === today,
  )
  if (grantedToday || waiting.length === 0) {
    return { awarded: null, waiting }
  }
  return { awarded: waiting[0], waiting: waiting.slice(1) }
}
