/**
 * Second collection of 10 bespoke Song-style no-text portrait illustrations.
 * Display availability is independent of achievement rarity and rollout.
 * Hidden locked achievements must not request their secret bespoke artwork.
 */
export const secondBatchAchievementIds = [
  'ACH_20_OF_30',
  'ACH_CONTINUE',
  'ACH_HINT_REDUCTION',
  'ACH_AUDIO_50',
  'ACH_RECOVER_3',
  'ACH_SPACED_20',
  'ACH_CHAPTER_80',
  'ACH_30_DAY',
  'ACH_TRUE_MEMORY',
  'ACH_OLD_RIVAL',
] as const

const secondBatchIdSet: ReadonlySet<string> = new Set(secondBatchAchievementIds)

export function getSecondBatchAchievementArtUrl(id: string, hiddenLocked = false): string | undefined {
  if (hiddenLocked || !secondBatchIdSet.has(id)) return undefined
  return (import.meta.env.BASE_URL || '/') + 'assets/achievements/song/second-batch/' + id + '.webp'
}
