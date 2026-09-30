import { readWordTelemetry } from './telemetry'
import type { IWordRecord, WordRecordTelemetry } from '@/utils/db/record'

export type WordHistorySummary = {
  recordCount: number
  failedRecordCount: number
  failureRate: number
  dominantWrongIndex?: number
  dominantWrongIndexRatio: number
  averageFirstKeyLatencyMs?: number
}

export type TypingBehaviorFeatures = {
  firstKeyLatencyMs?: number
  wrongAttemptCount: number
  cleanAttemptCount: number
  uniqueWrongPositionCount: number
  repeatedWrongPositionRatio: number
  adjacentWrongRatio: number
  averageInterKeyMs?: number
  maxInterKeyMs?: number
  history?: WordHistorySummary
}

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const
const QWERTY_OFFSETS = [0, 0.25, 0.75] as const

function keyCoordinate(key: string): { x: number; y: number } | undefined {
  const normalized = key.toLowerCase()
  for (let row = 0; row < QWERTY_ROWS.length; row++) {
    const column = QWERTY_ROWS[row].indexOf(normalized)
    if (column >= 0) {
      return { x: column + QWERTY_OFFSETS[row], y: row }
    }
  }
  return undefined
}

export function areQwertyNeighbors(expected: string | undefined, typed: string | undefined): boolean {
  if (!expected || !typed || expected.length !== 1 || typed.length !== 1) return false
  const a = keyCoordinate(expected)
  const b = keyCoordinate(typed)
  if (!a || !b) return false

  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return !(dx === 0 && dy === 0) && dx <= 1.25 && dy <= 1
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function extractTypingBehaviorFeatures(
  word: string,
  wrongCount: number,
  telemetry?: WordRecordTelemetry,
  history?: WordHistorySummary,
): TypingBehaviorFeatures {
  const attempts = telemetry?.attempts ?? []
  const wrongAttempts = attempts.filter(
    (attempt) =>
      attempt.result === 'wrong' &&
      attempt.wrongIndex !== undefined &&
      attempt.wrongIndex >= 0 &&
      attempt.wrongIndex < word.length,
  )
  const cleanAttempts = attempts.filter((attempt) => attempt.result === 'clean')
  const wrongPositions = wrongAttempts
    .map((attempt) => attempt.wrongIndex)
    .filter((index): index is number => index !== undefined)

  const positionCounts = new Map<number, number>()
  for (const index of wrongPositions) {
    positionCounts.set(index, (positionCounts.get(index) ?? 0) + 1)
  }
  const dominantPositionCount = wrongPositions.length > 0 ? Math.max(...Array.from(positionCounts.values())) : 0
  const repeatedAtDominantPosition =
    wrongPositions.length >= 2 && dominantPositionCount >= 2 ? dominantPositionCount / wrongPositions.length : 0

  const adjacentWrongCount = wrongAttempts.filter((attempt) =>
    areQwertyNeighbors(attempt.wrongIndex === undefined ? undefined : word[attempt.wrongIndex], attempt.wrongKey),
  ).length

  const intervals = attempts.flatMap((attempt) => attempt.interKeyIntervalsMs ?? [])

  return {
    firstKeyLatencyMs: telemetry?.firstKeyLatencyMs,
    wrongAttemptCount: telemetry ? wrongAttempts.length : wrongCount,
    cleanAttemptCount: cleanAttempts.length,
    uniqueWrongPositionCount: new Set(wrongPositions).size,
    repeatedWrongPositionRatio: repeatedAtDominantPosition,
    adjacentWrongRatio: wrongAttempts.length > 0 ? adjacentWrongCount / wrongAttempts.length : 0,
    averageInterKeyMs: average(intervals),
    maxInterKeyMs: intervals.length > 0 ? Math.max(...intervals) : undefined,
    history,
  }
}

export function summarizeWordHistory(records: IWordRecord[]): WordHistorySummary {
  const failedRecords = records.filter((record) => {
    const telemetry = readWordTelemetry(record)
    if (telemetry) {
      return telemetry.attempts.some(
        (attempt) =>
          attempt.result === 'wrong' &&
          attempt.wrongIndex !== undefined &&
          attempt.wrongIndex >= 0 &&
          attempt.wrongIndex < record.word.length,
      )
    }

    return Object.entries(record.mistakes).some(([rawIndex, wrongKeys]) => {
      const index = Number(rawIndex)
      return (
        Number.isInteger(index) &&
        index >= 0 &&
        index < record.word.length &&
        wrongKeys.length > 0
      )
    })
  })
  const positionCounts = new Map<number, number>()
  const firstKeyLatencies: number[] = []

  for (const record of records) {
    const telemetry = readWordTelemetry(record)
    if (telemetry) {
      firstKeyLatencies.push(telemetry.firstKeyLatencyMs)
      for (const attempt of telemetry.attempts) {
        if (
          attempt.result === 'wrong' &&
          attempt.wrongIndex !== undefined &&
          attempt.wrongIndex >= 0 &&
          attempt.wrongIndex < record.word.length
        ) {
          positionCounts.set(
            attempt.wrongIndex,
            (positionCounts.get(attempt.wrongIndex) ?? 0) + 1,
          )
        }
      }
    } else {
      for (const [rawIndex, wrongKeys] of Object.entries(record.mistakes)) {
        const index = Number(rawIndex)
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < record.word.length
        ) {
          positionCounts.set(
            index,
            (positionCounts.get(index) ?? 0) + wrongKeys.length,
          )
        }
      }
    }
  }

  let dominantWrongIndex: number | undefined
  let dominantCount = 0
  let totalWrongEvents = 0
  for (const [index, count] of positionCounts) {
    totalWrongEvents += count
    if (count > dominantCount) {
      dominantCount = count
      dominantWrongIndex = index
    }
  }

  return {
    recordCount: records.length,
    failedRecordCount: failedRecords.length,
    failureRate: records.length > 0 ? failedRecords.length / records.length : 0,
    dominantWrongIndex,
    dominantWrongIndexRatio: totalWrongEvents > 0 ? dominantCount / totalWrongEvents : 0,
    averageFirstKeyLatencyMs: average(firstKeyLatencies),
  }
}
