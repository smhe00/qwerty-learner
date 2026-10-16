/**
 * Song achievement image-production contract, on the isolated research branch.
 * An absent approved art pack is NOT replaced with generic SVG imagery.
 * Images for locked hidden achievements must never be requested.
 */
import type { AchievementDefinition } from '@/resources/achievementCulture'

export type SongTheme = 'light' | 'dark'
export type SongTier = 'ink' | 'celadon' | 'cinnabar'
export type SongAssetStage = 'pending_art_review' | 'approved'
export type SongVisualFamily = 'paper' | 'bowl' | 'fan' | 'scroll' | 'jade' | 'hidden'
export type SongSafeZone = { x: number; y: number; w: number; h: number }
export type SongVisualImages = {
  scene: string
  artifact: string
  mistFar: string
  mistNear: string
}
export type SongVisualPack = {
  id: string
  version: string
  stage: SongAssetStage
  family: SongVisualFamily
  tier: SongTier
  light: SongVisualImages
  dark: SongVisualImages
  seal: { red: string; ghost: string; press: string }
  safe: Record<'title' | 'description' | 'culture' | 'date' | 'seal', SongSafeZone>
}

/** The first real art pack is deliberately unapproved until image-quality review. */
const visualPacks: Record<string, SongVisualPack> = {
  ACH_MASTERED_100: {
    id: 'ACH_MASTERED_100',
    version: 'image-master-v1-draft',
    stage: 'pending_art_review',
    family: 'bowl',
    tier: 'celadon',
    light: {
      scene: 'ACH_MASTERED_100/scene-light.webp',
      artifact: 'ACH_MASTERED_100/artifact.webp',
      mistFar: 'shared/mist/far-light.webp',
      mistNear: 'shared/mist/near-light.webp',
    },
    dark: {
      scene: 'ACH_MASTERED_100/scene-dark.webp',
      artifact: 'ACH_MASTERED_100/artifact-dark.webp',
      mistFar: 'shared/mist/far-dark.webp',
      mistNear: 'shared/mist/near-dark.webp',
    },
    seal: {
      red: 'ACH_MASTERED_100/seal-red.webp',
      ghost: 'ACH_MASTERED_100/seal-ghost.webp',
      press: 'ACH_MASTERED_100/seal-press.webp',
    },
    safe: {
      title: { x: .16, y: .57, w: .68, h: .08 },
      description: { x: .12, y: .65, w: .76, h: .07 },
      culture: { x: .14, y: .72, w: .72, h: .14 },
      date: { x: .2, y: .86, w: .6, h: .08 },
      seal: { x: .69, y: .42, w: .19, h: .17 },
    },
  },
}

/**
 * Only approved packs may render. Hidden awards are intentionally unaddressable
 * while locked: do not probe their real image URLs, even in a prefetched cache.
 */
export function getApprovedSongVisualPack(
  achievement: Pick<AchievementDefinition, 'id' | 'hidden'>,
  unlocked: boolean,
): SongVisualPack | undefined {
  if (achievement.hidden && !unlocked) return undefined
  const pack = visualPacks[achievement.id]
  return pack?.stage === 'approved' ? pack : undefined
}

export function songTierFromRarity(rarity: AchievementDefinition['rarity']): SongTier {
  return rarity === 'common' ? 'ink' : rarity === 'rare' ? 'celadon' : 'cinnabar'
}

export function songAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return base + 'assets/achievements/song/' + relativePath
}

/** Mist is an approved shareable layer even before bespoke artifact art exists. */
export function songMistImageUrls(theme: SongTheme) {
  return {
    far: songAssetUrl('shared/mist/far-' + theme + '.webp'),
    near: songAssetUrl('shared/mist/near-' + theme + '.webp'),
  }
}
