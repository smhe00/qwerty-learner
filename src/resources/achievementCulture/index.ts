import achievementData from './achievements.json'
import cultureClassics1 from './culture-classics-1.json'
import cultureClassics2 from './culture-classics-2.json'
import cultureStories from './culture-stories.json'
import themeData from './themes.json'
import metricData from './metrics.json'

import type { AchievementDefinition, AchievementMetricDefinition, CultureEntry, SpiritTheme } from './types'

export const achievementDefinitions = achievementData as AchievementDefinition[]

export const cultureLibrary = [
  ...cultureClassics1,
  ...cultureClassics2,
  ...cultureStories,
] as CultureEntry[]

export const spiritThemes = themeData as SpiritTheme[]

export const achievementMetrics = metricData as AchievementMetricDefinition[]

export const achievementById = new Map(
  achievementDefinitions.map((achievement) => [achievement.id, achievement] as const),
)

export const cultureById = new Map(cultureLibrary.map((entry) => [entry.id, entry] as const))

export const spiritThemeById = new Map(spiritThemes.map((theme) => [theme.id, theme] as const))

export const achievementMetricById = new Map(achievementMetrics.map((metric) => [metric.id, metric] as const))

export function getAchievementCulture(achievementId: string) {
  const achievement = achievementById.get(achievementId)
  if (!achievement) return null

  const primary = cultureById.get(achievement.culture.primaryId) ?? null
  const alternates = achievement.culture.alternateIds
    .map((id) => cultureById.get(id))
    .filter((entry): entry is CultureEntry => Boolean(entry))

  return { achievement, primary, alternates }
}

export type {
  AchievementCategory,
  AchievementCondition,
  AchievementDefinition,
  AchievementMetricDefinition,
  AchievementRarity,
  CultureEntry,
  CultureType,
  SpiritTheme,
  SpiritThemeId,
} from './types'
