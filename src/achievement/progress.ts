import { isLongTermMastered } from '@/learn/mastery'
import type { IReviewWordState } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'

const DAY_SECONDS = 86_400

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type AchievementVisibleProgress = {
  longTermMasteredWords: number
  activeLearnDaysInLast10: number
}

export function buildAchievementVisibleProgress(input: {
  wordStates: IReviewWordState[]
  wordRecords: IWordRecord[]
  now: number
}): AchievementVisibleProgress {
  const today = new Date(input.now * 1000)
  today.setHours(0, 0, 0, 0)
  today.setDate(today.getDate() - 9)
  const start = Math.floor(today.getTime() / 1000)

  const activeDays = new Set(
    input.wordRecords
      .filter(
        (record) =>
          record.sourceMode === 'learn' &&
          record.timeStamp >= start &&
          record.timeStamp <= input.now,
      )
      .map((record) => localDateKey(record.timeStamp)),
  )

  return {
    longTermMasteredWords: input.wordStates.filter(isLongTermMastered).length,
    activeLearnDaysInLast10: activeDays.size,
  }
}
