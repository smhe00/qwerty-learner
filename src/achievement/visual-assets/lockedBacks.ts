import type { SongVisualTier } from './visualTiers'

/** Tier backs, not award-specific illustrations. A locked secret must never
 * fetch its unique collection piece or expose its title in the card. */
const lockedBackgrounds: Record<SongVisualTier,string> = {
  ink:'ink.webp',
  celadon:'celadon.webp',
  cinnabar:'cinnabar.webp',
  hidden:'hidden.webp',
}
export const getSongLockedBackUrl = (tier: SongVisualTier): string =>
  (import.meta.env.BASE_URL || '/') + 'assets/achievements/song/locked/' + lockedBackgrounds[tier]
