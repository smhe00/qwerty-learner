import type { IWordRecord } from '@/utils/db/record'

/** Read-only presentation of persisted attempts, not a scheduler or mastery estimate. */
export type HistoryPeriod = 7 | 30 | 'all'
export type HistoryWord = { dict: string; word: string; attempts: number; reviews: number }
export type HistoryDay = {
  date: string
  attempts: number
  reviews: number
  recordedMs: number
  timedAttempts: number
  words: HistoryWord[]
}
export type MobileHistorySummary = {
  attempts: number
  uniqueWords: number
  reviews: number
  activeDays: number
  recordedMs: number
  timedAttempts: number
  invalidRows: number
  days: HistoryDay[]
}

export function localHistoryDate(time: number): string {
  const date = new Date(time)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function recordedTime(row: IWordRecord): number | null {
  const telemetry = row.typingTelemetry
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (telemetry && valid(telemetry.firstKeyLatencyMs) && Array.isArray(telemetry.attempts) &&
      telemetry.attempts.every(attempt => attempt && valid(attempt.durationMs))) {
    return telemetry.firstKeyLatencyMs + telemetry.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  }
  if (!Array.isArray(row.timing) || row.timing.length === 0 || !row.timing.every(valid)) return null
  return row.timing.reduce((total, interval) => total + interval, 0)
}

export function summarizeMobileHistory(
  rows: readonly IWordRecord[],
  options: { period: HistoryPeriod; dictionary: string; now: number },
): MobileHistorySummary {
  const end = new Date(options.now)
  end.setHours(24, 0, 0, 0)
  const start = new Date(options.now)
  start.setHours(0, 0, 0, 0)
  if (options.period !== 'all') start.setDate(start.getDate() - options.period + 1)
  const from = options.period === 'all' ? 0 : start.getTime()
  const days = new Map<string, HistoryDay & { index: Map<string, HistoryWord> }>()
  const unique = new Set<string>()
  let invalidRows = 0
  let attempts = 0
  let reviews = 0
  let recordedMs = 0
  let timedAttempts = 0
  for (const row of rows) {
    if (!row || typeof row.dict !== 'string' || typeof row.word !== 'string' || !row.word ||
        !Number.isFinite(row.timeStamp) || row.timeStamp < 0 || !Number.isFinite(new Date(row.timeStamp * 1000).getTime())) {
      invalidRows++
      continue
    }
    if (options.dictionary && row.dict !== options.dictionary) continue
    const time = row.timeStamp * 1000
    if (time < from || time >= end.getTime()) continue
    const date = localHistoryDate(time)
    const day = days.get(date) ?? { date, attempts: 0, reviews: 0, recordedMs: 0, timedAttempts: 0, words: [], index: new Map<string, HistoryWord>() }
    const key = JSON.stringify([row.dict, row.word])
    // Legacy records without an explicit kind are not guessed to be reviews.
    const review = row.learnItemKind === 'review' ? 1 : 0
    const duration = recordedTime(row)
    const word = day.index.get(key) ?? { dict: row.dict, word: row.word, attempts: 0, reviews: 0 }
    word.attempts++
    word.reviews += review
    day.index.set(key, word)
    day.attempts++
    day.reviews += review
    attempts++
    reviews += review
    unique.add(key)
    if (duration !== null) {
      day.recordedMs += duration
      day.timedAttempts++
      recordedMs += duration
      timedAttempts++
    }
    days.set(date, day)
  }
  return {
    attempts, uniqueWords: unique.size, reviews, activeDays: days.size, recordedMs, timedAttempts, invalidRows,
    days: Array.from(days.values()).sort((a, b) => b.date.localeCompare(a.date)).map(({ index, ...day }) => ({
      ...day, words: Array.from(index.values()).sort((a, b) => b.attempts - a.attempts || a.word.localeCompare(b.word) || a.dict.localeCompare(b.dict)),
    })),
  }
}

export function formatHistoryTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return seconds + ' 秒'
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? minutes + ' 分 ' + seconds % 60 + ' 秒' : Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分'
}
