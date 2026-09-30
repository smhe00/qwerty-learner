import type { IWordRecord } from '@/utils/db/record'

export type OrthographyPositionProfile = {
  index: number
  errorRecordCount: number
  errorEventCount: number
  failedRecordRatio: number
}

export type OrthographyConfusion = {
  index: number
  expected: string
  typed: string
  count: number
}

export type OrthographyProfile = {
  word: string
  recordCount: number
  failedRecordCount: number
  totalWrongEvents: number
  positions: OrthographyPositionProfile[]
  confusions: OrthographyConfusion[]
  dominantWrongIndex?: number
  dominantWrongRecordCount: number
  dominantWrongRecordRatio: number
}

type PositionAccumulator = {
  eventCount: number
  recordCount: number
}

function addConfusion(
  counts: Map<string, OrthographyConfusion>,
  index: number,
  expected: string | undefined,
  typed: string | undefined,
) {
  if (!expected || !typed) return
  const key = [index, expected, typed].join('\u0000')
  const existing = counts.get(key)
  if (existing) {
    existing.count += 1
    return
  }

  counts.set(key, { index, expected, typed, count: 1 })
}

/**
 * Rebuilds spelling weakness directly from raw WordRecords.
 *
 * Record-level frequency is kept separate from raw event count so one bad
 * attempt cannot fabricate a stable weakness by repeating the same typo.
 */
export function buildOrthographyProfile(
  word: string,
  records: IWordRecord[],
): OrthographyProfile {
  const positions = new Map<number, PositionAccumulator>()
  const confusions = new Map<string, OrthographyConfusion>()
  let totalWrongEvents = 0
  let failedRecordCount = 0

  for (const record of records) {
    if (record.wrongCount > 0) failedRecordCount += 1

    const positionsSeenInRecord = new Set<number>()
    const telemetry =
      record.typingTelemetry?.telemetryVersion === 2 ? record.typingTelemetry : undefined

    if (telemetry) {
      for (const attempt of telemetry.attempts) {
        if (attempt.result !== 'wrong' || attempt.wrongIndex === undefined) continue

        const index = attempt.wrongIndex
        if (index < 0 || index >= word.length) continue
        const accumulator = positions.get(index) ?? { eventCount: 0, recordCount: 0 }
        accumulator.eventCount += 1
        positions.set(index, accumulator)
        positionsSeenInRecord.add(index)
        totalWrongEvents += 1
        addConfusion(confusions, index, word[index], attempt.wrongKey)
      }
    } else {
      for (const [rawIndex, wrongKeys] of Object.entries(record.mistakes)) {
        const index = Number(rawIndex)
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= word.length ||
          wrongKeys.length === 0
        ) {
          continue
        }

        const accumulator = positions.get(index) ?? { eventCount: 0, recordCount: 0 }
        accumulator.eventCount += wrongKeys.length
        positions.set(index, accumulator)
        positionsSeenInRecord.add(index)
        totalWrongEvents += wrongKeys.length

        for (const wrongKey of wrongKeys) {
          addConfusion(confusions, index, word[index], wrongKey)
        }
      }
    }

    for (const index of positionsSeenInRecord) {
      const accumulator = positions.get(index)
      if (accumulator) accumulator.recordCount += 1
    }
  }

  const positionProfiles = [...positions.entries()]
    .map(([index, value]) => ({
      index,
      errorRecordCount: value.recordCount,
      errorEventCount: value.eventCount,
      failedRecordRatio:
        failedRecordCount > 0 ? value.recordCount / failedRecordCount : 0,
    }))
    .sort((left, right) => left.index - right.index)

  const dominant = [...positionProfiles].sort((left, right) => {
    const recordDiff = right.errorRecordCount - left.errorRecordCount
    if (recordDiff !== 0) return recordDiff

    const eventDiff = right.errorEventCount - left.errorEventCount
    if (eventDiff !== 0) return eventDiff

    return left.index - right.index
  })[0]

  return {
    word,
    recordCount: records.length,
    failedRecordCount,
    totalWrongEvents,
    positions: positionProfiles,
    confusions: [...confusions.values()].sort((left, right) => {
      const countDiff = right.count - left.count
      if (countDiff !== 0) return countDiff
      return left.index - right.index
    }),
    dominantWrongIndex: dominant?.index,
    dominantWrongRecordCount: dominant?.errorRecordCount ?? 0,
    dominantWrongRecordRatio: dominant?.failedRecordRatio ?? 0,
  }
}
