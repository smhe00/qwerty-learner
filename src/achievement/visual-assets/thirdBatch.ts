/** Third curated batch: eight image-only Song landscape cards.
 * Art batch != award rarity or rollout; those stay in achievements.json.
 * Secret locked achievements must never fetch their unique artwork.
 */
export const thirdBatchAchievementIds = [
  'ACH_NO_HINT_25',
  'ACH_ERROR_POSITION_FIXED',
  'ACH_FAILURE_RECOVERY_SESSION',
  'ACH_WEEKLY_GAIN',
  'ACH_MASTERED_100',
  'ACH_MASTERED_500',
  'ACH_RECOVER_5_STABLE',
  'ACH_90_DAY',
] as const

const thirdBatchIdSet: ReadonlySet<string> = new Set(thirdBatchAchievementIds)

export function getThirdBatchAchievementArtUrl(id: string, hiddenLocked = false): string | undefined {
  if (hiddenLocked || !thirdBatchIdSet.has(id)) return undefined
  return (import.meta.env.BASE_URL || '/') + 'assets/achievements/song/third-batch/' + id + '.webp'
}

/** Only these seven third-batch scenes have been replaced with individually
 * reviewed 960×1391 border-free paintings. The eighth (ACH_90_DAY) and all
 * other artwork retain their original frame and image without modification. */
const sharedOriginalFrameIds: ReadonlySet<string> = new Set([
  "ACH_NO_HINT_25",
  "ACH_ERROR_POSITION_FIXED",
  "ACH_FAILURE_RECOVERY_SESSION",
  "ACH_WEEKLY_GAIN",
  "ACH_MASTERED_100",
  "ACH_MASTERED_500",
  "ACH_RECOVER_5_STABLE"
])
export const usesOriginalSongFrameOverlay = (id: string): boolean => sharedOriginalFrameIds.has(id)
