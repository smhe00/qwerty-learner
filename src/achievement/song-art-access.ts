import type { IWordRecord } from '@/utils/db/record'

export type SongArtAccess = {
  eligible: boolean
  activeDays: number
  bestStreak: number
}

const DAY_MS = 86_400_000

/** The optional art collection becomes available once the learner has ever
 * completed Learn attempts on three consecutive LOCAL calendar dates.
 * Mere site visits, Typing, and future-dated attempts never count. An earned
 * entitlement is durable in the evidence: a later break does not revoke it.
 * This is a presentation-only gate and does not award any achievement.
 */
export function assessSongArtAccess(
  records: Pick<IWordRecord, 'sourceMode' | 'timeStamp'>[],
  now: number,
): SongArtAccess {
  const dayIndices = new Set<number>()
  for (const record of records) {
    if (record.sourceMode !== 'learn' ||
        !Number.isFinite(record.timeStamp) ||
        record.timeStamp <= 0 ||
        record.timeStamp > now) continue
    const date = new Date(record.timeStamp * 1000)
    if (!Number.isFinite(date.getTime())) continue
    dayIndices.add(Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS))
  }
  const days = [...dayIndices].sort((a, b) => a - b)
  let streak = 0
  let longest = 0
  let last: number | undefined
  for (const day of days) {
    streak = last === day - 1 ? streak + 1 : 1
    longest = Math.max(longest, streak)
    last = day
  }
  return { eligible: longest >= 3, activeDays: days.length, bestStreak: longest }
}
