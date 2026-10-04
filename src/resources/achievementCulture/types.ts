export type SpiritThemeId =
  | 'first_step'
  | 'perseverance'
  | 'recovery'
  | 'review'
  | 'self_mastery'
  | 'growth'
  | 'resilience'
  | 'long_view'
  | 'focus'
  | 'curiosity'
  | 'craft'
  | 'courage'

export type AchievementCategory =
  | 'breakthrough'
  | 'skill'
  | 'recovery'
  | 'growth'
  | 'memory'
  | 'consistency'
  | 'exploration'
  | 'milestone'
  | 'craft'
  | 'hidden'

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'hidden'

export type CultureType =
  | 'poetry'
  | 'classical_prose'
  | 'classic_saying'
  | 'historical_story'
  | 'historical_person'
  | 'idiom'

export interface SpiritTheme {
  id: SpiritThemeId
  label: string
  meaning: string
  symbol: string
}

export interface CultureCurriculumMeta {
  stage: 'junior_middle' | 'general'
  relevance: 'high' | 'medium' | 'general'
  usage: string[]
  /**
   * Never claim "Shanghai Zhongkao required" without a date-specific review.
   */
  shanghaiExamClaim: 'not_claimed' | 'verified_for_specific_year'
}

export interface CultureArtDirection {
  motif: string
  scene: string
  style: string
  avoidTextInImage: boolean
}

export interface CultureEntry {
  id: string
  type: CultureType
  title: string
  text: string
  source: string
  author: string
  era: string
  themes: SpiritThemeId[]
  studentMeaning: string
  storySummary?: string | null
  curriculum: CultureCurriculumMeta
  artDirection: CultureArtDirection
}

export type AchievementOperator = 'gte' | 'lte' | 'eq' | 'gt' | 'lt'

export interface AchievementCondition {
  metric: string
  operator: AchievementOperator
  target: number
  window?: string | null
  constraints: Record<string, string | number | boolean>
}

export interface AchievementCultureBinding {
  primaryId: string
  alternateIds: string[]
}

export interface AchievementDefinition {
  id: string
  title: string
  category: AchievementCategory
  rarity: AchievementRarity
  themes: SpiritThemeId[]
  hidden: boolean
  enabled: boolean
  condition: AchievementCondition
  culture: AchievementCultureBinding
  copy: {
    unlockMessage: string
    reflection: string
  }
  antiGaming: string
  artDirection: {
    symbol: string
    scene: string
    illustrationPrompt: string
  }
}
