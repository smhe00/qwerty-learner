import {
  isAcquisitionIntroductionRecord,
  isCompletedAcquisitionRecord,
} from './admission'
import type { IReviewWordState } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'

export const LEARN_DAILY_SESSION_VERSION = 1 as const
export const LEARN_DAILY_SESSION_STORAGE_PREFIX =
  'qwerty.learn.dailySession.v1'

export type LearnDailySessionStatus =
  | 'active'
  | 'completed'
  | 'abandoned'

export type LearnDailySessionV1 = {
  version: typeof LEARN_DAILY_SESSION_VERSION
  sessionId: string
  dict: string
  dateKey: string
  startedAt: number
  status: LearnDailySessionStatus
  dailyNewTarget: number
  plannedNewWords: number
  plannedReviewWords: string[]
  carryOverAcquisitionWords: string[]
  accumulatedActiveSeconds: number
  completedBlockIds: string[]
  blockCount: number
  completedAt?: number
}

export type LearnDailyProgress = {
  targetWords: number
  completedWords: number
  remainingWords: number
  percent: number
  reviewTargetWords: number
  completedReviewWords: number
  carryOverTargetWords: number
  completedCarryOverWords: number
  newTargetWords: number
  introducedNewWords: number
  completedNewWords: number
  independentCompletedWords: string[]
  introducedNewWordNames: string[]
  complete: boolean
}

function uniqueNames(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))]
}

export function learnLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function storageKey(dict: string) {
  return `${LEARN_DAILY_SESSION_STORAGE_PREFIX}.${dict}`
}

export function loadLearnDailySession(
  dict: string,
): LearnDailySessionV1 | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(storageKey(dict))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<LearnDailySessionV1>
    if (
      value.version !== LEARN_DAILY_SESSION_VERSION ||
      value.dict !== dict ||
      typeof value.sessionId !== 'string' ||
      typeof value.dateKey !== 'string' ||
      typeof value.startedAt !== 'number' ||
      !Array.isArray(value.plannedReviewWords) ||
      !Array.isArray(value.carryOverAcquisitionWords) ||
      !Array.isArray(value.completedBlockIds)
    ) {
      return null
    }
    return value as LearnDailySessionV1
  } catch {
    return null
  }
}

export function saveLearnDailySession(
  session: LearnDailySessionV1,
): LearnDailySessionV1 {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      storageKey(session.dict),
      JSON.stringify(session),
    )
  }
  return session
}

export function clearLearnDailySession(dict: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(storageKey(dict))
  }
}

export function clearAllLearnDailySessions(): void {
  if (typeof window === 'undefined') return

  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (
      key &&
      key.startsWith(`${LEARN_DAILY_SESSION_STORAGE_PREFIX}.`)
    ) {
      keys.push(key)
    }
  }
  for (const key of keys) window.localStorage.removeItem(key)
}

function firstAcquisitionIntroductionByWord(
  wordRecords: IWordRecord[],
): Map<string, IWordRecord> {
  const first = new Map<string, IWordRecord>()

  for (const record of wordRecords) {
    if (!isAcquisitionIntroductionRecord(record)) continue
    const previous = first.get(record.word)
    if (
      !previous ||
      record.timeStamp < previous.timeStamp ||
      (record.timeStamp === previous.timeStamp &&
        (record.id ?? 0) < (previous.id ?? 0))
    ) {
      first.set(record.word, record)
    }
  }

  return first
}

export function createLearnDailySession(input: {
  dict: string
  now: number
  dailyNewTarget: number
  dictionaryWords: string[]
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
}): LearnDailySessionV1 {
  const dailyNewTarget = Math.max(
    1,
    Math.floor(input.dailyNewTarget),
  )
  const activeStates = input.wordStates.filter(
    (state) => state.lifecycle !== 'excluded',
  )
  const plannedReviewWords = uniqueNames(
    activeStates
      .filter((state) => state.nextReviewAt <= input.now)
      .map((state) => state.word),
  )

  const firstIntroductions = firstAcquisitionIntroductionByWord(
    input.wordRecords,
  )
  const stateNames = new Set(input.wordStates.map((state) => state.word))
  const carryOverAcquisitionWords = uniqueNames(
    [...firstIntroductions.keys()].filter(
      (word) => !stateNames.has(word),
    ),
  )

  const knownNames = new Set([
    ...stateNames,
    ...firstIntroductions.keys(),
  ])
  const uniqueDictionaryWords = uniqueNames(input.dictionaryWords)
  const unseenCount = uniqueDictionaryWords.filter(
    (word) => !knownNames.has(word),
  ).length
  const plannedNewWords = Math.min(dailyNewTarget, unseenCount)
  const dateKey = learnLocalDateKey(input.now)

  return {
    version: LEARN_DAILY_SESSION_VERSION,
    sessionId: `${input.dict}:${dateKey}:${input.now}`,
    dict: input.dict,
    dateKey,
    startedAt: input.now,
    status: 'active',
    dailyNewTarget,
    plannedNewWords,
    plannedReviewWords,
    carryOverAcquisitionWords,
    accumulatedActiveSeconds: 0,
    completedBlockIds: [],
    blockCount: 0,
  }
}

export function ensureLearnDailySession(input: {
  dict: string
  now: number
  dailyNewTarget: number
  dictionaryWords: string[]
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
}): LearnDailySessionV1 {
  const existing = loadLearnDailySession(input.dict)
  const today = learnLocalDateKey(input.now)

  if (existing?.dateKey === today) {
    return existing
  }

  if (existing?.status === 'active') {
    saveLearnDailySession({
      ...existing,
      status: 'abandoned',
    })
  }

  return saveLearnDailySession(createLearnDailySession(input))
}

function isIndependentCleanReview(record: IWordRecord): boolean {
  return (
    record.sourceMode === 'learn' &&
    record.learnItemKind !== 'acquisition' &&
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.reviewEvidence?.errorCause === 'clean'
  )
}

function hasRecordAfter(
  records: IWordRecord[],
  word: string,
  startedAt: number,
  predicate: (record: IWordRecord) => boolean,
): boolean {
  return records.some(
    (record) =>
      record.word === word &&
      record.timeStamp >= startedAt &&
      predicate(record),
  )
}

export function deriveLearnDailyProgress(input: {
  session: LearnDailySessionV1
  wordRecords: IWordRecord[]
}): LearnDailyProgress {
  const { session } = input
  const records = input.wordRecords.filter(
    (record) => record.dict === session.dict,
  )

  const reviewTargets = uniqueNames(session.plannedReviewWords)
  const carryOverTargets = uniqueNames(
    session.carryOverAcquisitionWords,
  )

  const firstIntroductions = firstAcquisitionIntroductionByWord(records)
  const introducedNewWordNames = [...firstIntroductions.values()]
    .filter((record) => record.timeStamp >= session.startedAt)
    .sort((left, right) => {
      const diff = left.timeStamp - right.timeStamp
      return diff !== 0 ? diff : (left.id ?? 0) - (right.id ?? 0)
    })
    .map((record) => record.word)
    .filter((word) => !carryOverTargets.includes(word))
    .slice(0, session.plannedNewWords)

  const completedReviewNames = reviewTargets.filter((word) =>
    hasRecordAfter(
      records,
      word,
      session.startedAt,
      isIndependentCleanReview,
    ),
  )

  const completedCarryOverNames = carryOverTargets.filter((word) =>
    hasRecordAfter(
      records,
      word,
      session.startedAt,
      isCompletedAcquisitionRecord,
    ),
  )

  const completedNewNames = introducedNewWordNames.filter((word) =>
    hasRecordAfter(
      records,
      word,
      session.startedAt,
      isCompletedAcquisitionRecord,
    ),
  )

  const independentCompletedWords = uniqueNames([
    ...completedReviewNames,
    ...completedCarryOverNames,
    ...completedNewNames,
  ])

  const targetWords =
    reviewTargets.length +
    carryOverTargets.length +
    session.plannedNewWords
  const completedWords = Math.min(
    targetWords,
    independentCompletedWords.length,
  )
  const remainingWords = Math.max(0, targetWords - completedWords)
  const percent =
    targetWords === 0
      ? 100
      : Math.round((completedWords / targetWords) * 100)

  return {
    targetWords,
    completedWords,
    remainingWords,
    percent,
    reviewTargetWords: reviewTargets.length,
    completedReviewWords: completedReviewNames.length,
    carryOverTargetWords: carryOverTargets.length,
    completedCarryOverWords: completedCarryOverNames.length,
    newTargetWords: session.plannedNewWords,
    introducedNewWords: introducedNewWordNames.length,
    completedNewWords: completedNewNames.length,
    independentCompletedWords,
    introducedNewWordNames,
    complete: remainingWords === 0,
  }
}

export function recordLearnBlockCompletion(input: {
  session: LearnDailySessionV1
  blockId: string
  activeSeconds: number
}): LearnDailySessionV1 {
  if (input.session.completedBlockIds.includes(input.blockId)) {
    return input.session
  }

  return saveLearnDailySession({
    ...input.session,
    accumulatedActiveSeconds:
      input.session.accumulatedActiveSeconds +
      Math.max(0, Math.floor(input.activeSeconds)),
    completedBlockIds: [
      ...input.session.completedBlockIds,
      input.blockId,
    ],
    blockCount: input.session.blockCount + 1,
  })
}

export function completeLearnDailySession(
  session: LearnDailySessionV1,
  now: number,
): LearnDailySessionV1 {
  if (session.status === 'completed') return session

  return saveLearnDailySession({
    ...session,
    status: 'completed',
    completedAt: now,
  })
}
