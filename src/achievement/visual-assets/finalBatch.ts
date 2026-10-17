/** Final group of six bespoke, text-free Song visual assets.
 * Five hidden achievements must never be requested on an unearned production card.
 * The public read-only museum demo explicitly displays all six artworks.
 */
export const finalBatchAchievementIds = [
  'ACH_MASTERED_1000',
  'ACH_HIDDEN_90_DIFFICULT',
  'ACH_HIDDEN_CRAFT',
  'ACH_HIDDEN_DAWN',
  'ACH_HIDDEN_FINISH_STRONG',
  'ACH_HIDDEN_SMALL_STEPS',
] as const

const idSet: ReadonlySet<string> = new Set(finalBatchAchievementIds)

export function getFinalBatchAchievementArtUrl(id: string, hiddenLocked = false): string | undefined {
  if (hiddenLocked || !idSet.has(id)) return undefined
  return (import.meta.env.BASE_URL || '/') + 'assets/achievements/song/final-batch/' + id + '.webp'
}
