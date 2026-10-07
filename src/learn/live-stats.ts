import { isAcquisitionIntroductionRecord, isLearnProvenanceRecord } from './admission'
import { countLearnSessionLogicalWords, resolveLearnItemKindForWord } from './session'
import type { LearnAcquisitionPhase } from './acquisition'
import type { ReviewItemPhase } from '@/review/state-machine'
import type { IReviewRecord, IWordRecord } from '@/utils/db/record'

/**
 * Learn-only live statistics for the active session strip.
 *
 * The five values are deliberately cumulative and non-negative: Learn exposes
 * progress and earned achievement while Typing keeps its own pressure-bearing
 * counters (WPM / accuracy / errors). Nothing here may be reinterpreted as a
 * Typing statistic, and no new persisted schema is introduced.
 */
export type LearnLiveStats = {
  elapsedSeconds: number
  completedLogicalWords: number
  totalLogicalWords: number
  newLearnedWords: number
  reviewedWords: number
  independentRecallWords: number
}

export type LearnLiveStatsEvidence = Omit<LearnLiveStats, 'elapsedSeconds'>

export type LearnLiveStatsInput = {
  reviewRecord?: IReviewRecord | null
  wordRecords?: IWordRecord[] | null
  elapsedSeconds?: number
}

export type LearnTodayIntroducedInput = {
  dict?: string | null
  wordRecords?: IWordRecord[] | null
  now?: number
}

const EMPTY_EVIDENCE: LearnLiveStatsEvidence = {
  completedLogicalWords: 0,
  totalLogicalWords: 0,
  newLearnedWords: 0,
  reviewedWords: 0,
  independentRecallWords: 0,
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max < min) return min
  return Math.min(Math.max(Math.floor(value), min), max)
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function compareRecordOrder(
  left: IWordRecord,
  right: IWordRecord,
): number {
  const timeDiff = left.timeStamp - right.timeStamp
  if (timeDiff !== 0) return timeDiff
  return (left.id ?? 0) - (right.id ?? 0)
}

/**
 * Daily new-word progress is based on the first durable Learn acquisition
 * introduction for each word. A word started yesterday and reinforced today
 * is not counted again today.
 */
export function countTodayIntroducedLearnWords(
  input: LearnTodayIntroducedInput,
): number {
  if (!input.dict) return 0

  const firstIntroductionByWord = new Map<string, IWordRecord>()
  for (const candidate of input.wordRecords ?? []) {
    if (
      candidate.dict !== input.dict ||
      !isAcquisitionIntroductionRecord(candidate)
    ) {
      continue
    }

    const previous = firstIntroductionByWord.get(candidate.word)
    if (!previous || compareRecordOrder(candidate, previous) < 0) {
      firstIntroductionByWord.set(candidate.word, candidate)
    }
  }

  const todayKey = localDateKey(
    input.now ?? Math.floor(Date.now() / 1000),
  )

  return [...firstIntroductionByWord.values()].filter(
    (record) => localDateKey(record.timeStamp) === todayKey,
  ).length
}

function isTerminalReviewPhase(phase: ReviewItemPhase): boolean {
  return phase === 'done' || phase === 'deferred'
}

function isTerminalAcquisitionPhase(phase: LearnAcquisitionPhase): boolean {
  return phase === 'complete' || phase === 'deferred'
}

function hasLearnItemStateMetadata(record: IReviewRecord): boolean {
  return (
    Object.keys(record.itemStates ?? {}).length > 0 ||
    Object.keys(record.acquisitionStates ?? {}).length > 0
  )
}

/**
 * Conservative reconstruction for checkpoints written before per-item state
 * existed. Only the already-consumed queue prefix counts, so a reinforcement
 * or retry occurrence inserted later in the queue cannot inflate progress.
 */
function countCompletedQueuePrefix(record: IReviewRecord): number {
  const limit = clamp(record.index ?? 0, 0, record.words.length)
  const names = new Set<string>()

  for (let position = 0; position < limit; position += 1) {
    const name = record.words[position]?.name
    if (name) names.add(name)
  }

  return names.size
}

function collectSessionWordNames(record: IReviewRecord): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const word of record.words) {
    const name = word?.name
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

function collectSessionRecords(
  record: IReviewRecord,
  wordRecords: IWordRecord[],
): IWordRecord[] {
  const sessionWords = new Set(collectSessionWordNames(record))
  const windowStart = record.createTime

  return wordRecords.filter((candidate) => {
    if (candidate.dict !== record.dict) return false
    if (!sessionWords.has(candidate.word)) return false
    // A recovered session must read the same evidence as a live one, so the
    // window is anchored on the session checkpoint rather than on "today".
    if (candidate.timeStamp < windowStart) return false
    return isLearnProvenanceRecord(candidate)
  })
}

/**
 * Strict positive-only recall evidence.
 *
 * Assisted success and independent failure are both excluded: the slot means
 * "the learner produced the spelling independently and cleanly", not
 * "the attempt was ultimately correct".
 */
export function isIndependentRecallEvidence(record: IWordRecord): boolean {
  return (
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.reviewEvidence?.errorCause === 'clean'
  )
}

export function deriveLearnLiveStats(
  input: LearnLiveStatsInput,
): LearnLiveStatsEvidence {
  const record = input.reviewRecord
  if (!record || !Array.isArray(record.words) || record.words.length === 0) {
    return { ...EMPTY_EVIDENCE }
  }

  const totalLogicalWords = countLearnSessionLogicalWords(record)
  const sessionWordNames = collectSessionWordNames(record)
  const sessionRecords = collectSessionRecords(record, input.wordRecords ?? [])

  let completedLogicalWords = 0
  if (hasLearnItemStateMetadata(record)) {
    for (const wordName of sessionWordNames) {
      if (resolveLearnItemKindForWord(record, wordName) === 'acquisition') {
        const phase = record.acquisitionStates?.[wordName]?.phase
        if (phase && isTerminalAcquisitionPhase(phase)) {
          completedLogicalWords += 1
        }
        continue
      }

      const phase = record.itemStates?.[wordName]?.phase
      if (phase && isTerminalReviewPhase(phase)) {
        completedLogicalWords += 1
      }
    }
  } else {
    completedLogicalWords = countCompletedQueuePrefix(record)
  }
  completedLogicalWords = clamp(completedLogicalWords, 0, totalLogicalWords)

  // 新学: unique acquisition words with durable Learn introduction evidence.
  // Queue membership alone is never enough, so a word still waiting in the
  // session cannot be reported as already learned.
  const newLearnedNames = new Set<string>()
  for (const candidate of sessionRecords) {
    if (isAcquisitionIntroductionRecord(candidate)) {
      newLearnedNames.add(candidate.word)
    }
  }

  // 已复习: authoritative terminal Review item state first, then a completed
  // persisted Review attempt. Acquisition words never land here.
  const reviewedNames = new Set<string>()
  for (const candidate of sessionRecords) {
    if (candidate.learnItemKind === 'acquisition') continue
    reviewedNames.add(candidate.word)
  }
  for (const wordName of sessionWordNames) {
    if (resolveLearnItemKindForWord(record, wordName) !== 'review') continue
    const phase = record.itemStates?.[wordName]?.phase
    if (phase && isTerminalReviewPhase(phase)) {
      reviewedNames.add(wordName)
    }
  }

  const independentRecallNames = new Set<string>()
  for (const candidate of sessionRecords) {
    if (isIndependentRecallEvidence(candidate)) {
      independentRecallNames.add(candidate.word)
    }
  }

  return {
    completedLogicalWords,
    totalLogicalWords,
    newLearnedWords: newLearnedNames.size,
    reviewedWords: reviewedNames.size,
    independentRecallWords: independentRecallNames.size,
  }
}

export function buildLearnLiveStats(
  input: LearnLiveStatsInput,
): LearnLiveStats {
  return {
    ...deriveLearnLiveStats(input),
    elapsedSeconds: clamp(input.elapsedSeconds ?? 0, 0, Number.MAX_SAFE_INTEGER),
  }
}
