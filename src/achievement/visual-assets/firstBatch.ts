/**
 * First independent, text-free Song achievement art collection.
 * Keep the real rarity and rollout in achievements.json; do not derive them
 * from artwork batch order. Hidden locked items must never load bespoke art.
 */
export const firstBatchAchievementIds = [
  'ACH_FIRST_TRY',
  'ACH_FIRST_DECODE',
  'ACH_WARMING_UP',
  'ACH_NEW_UNIT',
  'ACH_DAILY_GOAL',
  'ACH_7_OF_10',
  'ACH_RECOVER_1',
  'ACH_AUDIO_10',
  'ACH_NO_HINT_10',
  'ACH_7_DAY',
] as const

const firstBatchIdSet: ReadonlySet<string> = new Set(firstBatchAchievementIds)

/** Returns undefined for any unapproved/missing/hidden-locked image. */
export function getFirstBatchAchievementArtUrl(id: string, hiddenLocked = false): string | undefined {
  if (hiddenLocked || !firstBatchIdSet.has(id)) return undefined
  return (import.meta.env.BASE_URL || '/') + 'assets/achievements/song/first-batch/' + id + '.webp'
}
