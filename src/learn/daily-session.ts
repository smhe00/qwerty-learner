import { DEFAULT_LEARN_BLOCK_SIZE } from './block-size'
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
  optionalNewWordNames?: string[]
  /** Frozen identities for one explicit round of up to five unfinished/new words. */
  extraRoundWordNames?: string[]
  extraRoundStartedAt?: number
  /** No executable work remains today; unresolved words are retained. */
  executionExhausted?: boolean
  extraNewWordCount?: number
  plannedNewWords: number
  /** Frozen identities for newly introduced words, optional on legacy V1 sessions. */
  plannedNewWordNames?: string[]
  /** Cumulative milestones for meaningful Block celebrations, not queue sizes. */
  blockMilestones?: number[]
  celebratedMilestones?: number[]
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

/** Balance Block milestones across the fixed daily cohort; never create a one-word tail. */
export function planLearnBlockMilestones(total: number, targetSize = DEFAULT_LEARN_BLOCK_SIZE): number[] {
  if (total <= 0) return []
  const blocks = Math.max(1, Math.ceil(total / targetSize))
  const base = Math.floor(total / blocks)
  const extra = total % blocks
  let cumulative = 0
  return Array.from({ length: blocks }, (_, index) => {
    cumulative += base + (index < extra ? 1 : 0)
    return cumulative
  })
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
  const plannedNewWordNames = uniqueDictionaryWords
    .filter((word) => !knownNames.has(word))
    .slice(0, plannedNewWords)
  const blockMilestones = planLearnBlockMilestones(
    plannedReviewWords.length + carryOverAcquisitionWords.length + plannedNewWordNames.length,
  )
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
    plannedNewWordNames,
    blockMilestones,
    celebratedMilestones: [],
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
      record.learnItemKind !== 'practice' &&
    record.reviewRatingDecision?.eligible === true &&
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
    .filter((word) => !session.plannedNewWordNames || session.plannedNewWordNames.includes(word))
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

/** Explicitly extend today's frozen cohort without changing the recurring target. */
export function addLearnDailyNewWords(input: {
  session: LearnDailySessionV1
  now: number
  dictionaryWords: string[]
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
}): LearnDailySessionV1 {
  const { session } = input
  if ((session.status !== 'completed' && !(session.status === 'active' && session.executionExhausted)) || session.dateKey !== learnLocalDateKey(input.now)) return session
  const known = new Set([
    ...(session.plannedNewWordNames ?? []),
    ...session.plannedReviewWords,
    ...session.carryOverAcquisitionWords,
    ...input.wordStates.map(state => state.word),
    ...Array.from(firstAcquisitionIntroductionByWord(input.wordRecords).keys()),
  ])
  const completed = new Set(deriveLearnDailyProgress({ session, wordRecords: input.wordRecords }).independentCompletedWords)
  const excluded = new Set(input.wordStates
    .filter(state => state.dict === session.dict && state.lifecycle === 'excluded')
    .map(state => state.word))
  const dictionary = new Set(input.dictionaryWords)
  const optionalPending = Array.from(firstAcquisitionIntroductionByWord(input.wordRecords).keys())
    .filter(name => !input.wordStates.some(state => state.word === name) &&
      !input.wordRecords.some(record => record.word === name && isCompletedAcquisitionRecord(record)))
  const unfinished = uniqueNames([...session.plannedReviewWords, ...session.carryOverAcquisitionWords, ...(session.plannedNewWordNames ?? []), ...optionalPending])
    .filter(name => dictionary.has(name) && !excluded.has(name) && !completed.has(name)).slice(0, 5)
  const added = uniqueNames(input.dictionaryWords).filter(name => !known.has(name)).slice(0, 5 - unfinished.length)
  const round = [...unfinished, ...added]
  if (!round.length) return session
  const plannedNewWords = session.plannedNewWords + added.length
  const previousTotal = session.plannedReviewWords.length + session.carryOverAcquisitionWords.length + session.plannedNewWords
  return saveLearnDailySession({
    ...session,
    status: 'active',
    completedAt: undefined,
    executionExhausted: undefined,
    plannedNewWords,
    extraNewWordCount: (session.extraNewWordCount ?? 0) + added.length,
    extraRoundWordNames: round,
    extraRoundStartedAt: input.now,
    carryOverAcquisitionWords: uniqueNames([...session.carryOverAcquisitionWords, ...unfinished.filter(name => !session.plannedReviewWords.includes(name) && !(session.plannedNewWordNames ?? []).includes(name))]),
    plannedNewWordNames: [...(session.plannedNewWordNames ?? deriveLearnDailyProgress({ session, wordRecords: input.wordRecords }).introducedNewWordNames), ...added],
    blockMilestones: [...(session.blockMilestones ?? []), previousTotal + added.length],
  })
}


/** Legacy add-five sessions recover the most recently appended five identities. */
export function getLearnExtraRoundNames(session: LearnDailySessionV1 | null): string[] | undefined {
  if (!session) return undefined
  if (session.extraRoundWordNames) return session.extraRoundWordNames
  if (!(session.extraNewWordCount ?? 0)) return undefined
  return session.plannedNewWordNames?.slice(-Math.min(5, session.extraNewWordCount ?? 0))
}

export function deriveLearnExecutionProgress(input: { session: LearnDailySessionV1; wordRecords: IWordRecord[] }): LearnDailyProgress {
  const names = getLearnExtraRoundNames(input.session)
  return deriveLearnDailyProgress({ ...input, session: names ? {
    ...input.session,
    plannedNewWords: names.filter(name => !input.session.plannedReviewWords.includes(name) && !input.session.carryOverAcquisitionWords.includes(name)).length,
    plannedNewWordNames: names.filter(name => !input.session.plannedReviewWords.includes(name) && !input.session.carryOverAcquisitionWords.includes(name)),
    plannedReviewWords: input.session.plannedReviewWords.filter(name => names.includes(name)),
    carryOverAcquisitionWords: input.session.carryOverAcquisitionWords.filter(name => names.includes(name)),
  } : input.session })
}

export function isLearnSessionOutsideExtraRound(record: { words: Array<{ name: string }>; optionalNewWords?: Array<{ name: string }> }, session: LearnDailySessionV1 | null): boolean {
  const names = getLearnExtraRoundNames(session)
  return !!names && (!!record.optionalNewWords?.length || record.words.some(word => !names.includes(word.name)))
}
