import type { AchievementDefinition } from '@/resources/achievementCulture'

export type AchievementCeremonyPresentation = {
  layout: 'compact' | 'standard' | 'spotlight' | 'ceremony'
  showCulture: boolean
  showReflection: boolean
  label: string
}

export function resolveAchievementCeremonyPresentation(
  achievement: AchievementDefinition,
): AchievementCeremonyPresentation {
  switch (achievement.presentation.ceremony) {
    case 'quiet':
      return {
        layout: 'compact',
        showCulture: false,
        showReflection: false,
        label: '新成就',
      }
    case 'settlement':
      return {
        layout: 'standard',
        showCulture: true,
        showReflection: false,
        label: '新成就',
      }
    case 'spotlight':
      return {
        layout: 'spotlight',
        showCulture: true,
        showReflection: true,
        label: '重要突破',
      }
    case 'ceremony':
      return {
        layout: 'ceremony',
        showCulture: true,
        showReflection: true,
        label: '里程碑',
      }
  }
}
