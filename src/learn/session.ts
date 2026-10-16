import { DEFAULT_LEARN_BLOCK_SIZE, LEGACY_LEARN_BLOCK_SIZE, normalizeLearnBlockSize } from './block-size'
import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  createLearnAcquisitionExercisePlanForState,
  createLearnAcquisitionState,
  deferredAcquisitionCohortResumeTimes,
  resumeDeferredAcquisition,
  resumeDeferredAsTerminalProbe,
} from './acquisition'
import { learnLocalDateKey } from './daily-session'
import type { LearnAcquisitionState } from './acquisition'
import type { LearnInteractionStrainTier } from './strain'
import type { ReviewExercisePlanV1 } from '@/review/decision'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'

export const LEARN_ACQUISITION_POLICY_VERSION =
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION
export const LEARN_NEW_WORD_BATCH_SIZE = DEFAULT_LEARN_BLOCK_SIZE
export const LEARN_BLOCK_TARGET_SIZE = DEFAULT_LEARN_BLOCK_SIZE
/** @deprecated Product-level Learn Session is now the daily plan; this alias is block-sized. */
export const LEARN_SESSION_TARGET_SIZE = LEARN_BLOCK_TARGET_SIZE
export const LEARN_MIXED_NEW_WORD_RESERVE = 5

export type LearnItemKind = 'review' | 'acquisition' | 'practice'
export type LearnSessionKind = 'review' | 'acquisition' | 'mixed'

export type LearnSessionItemKindSnapshot = {
  sessionKind?: LearnSessionKind
  itemKinds?: Record<string, LearnItemKind>
  acquisitionStates?: Record<string, LearnAcquisitionState>
}

export function resolveLearnItemKindForWord(
  snapshot: LearnSessionItemKindSnapshot,
  wordName: string,
): LearnItemKind {
  const explicit = snapshot.itemKinds?.[wordName]
  if (explicit) return explicit

  if (snapshot.sessionKind === 'acquisition') {
    return 'acquisition'
  }

  // Legacy mixed checkpoints can predate itemKinds while still carrying the
  // stronger per-word acquisition state. Never route such a word through the
  // Review completion path merely because itemKinds metadata is absent.
  if (snapshot.acquisitionStates?.[wordName]) {
    return 'acquisition'
  }

  return 'review'
}

export type LearnSessionCohortSnapshot = {
  isFinished?: boolean
  blockSize?: number
  sessionKind?: LearnSessionKind
  words: Array<{ name: string }>
  itemKinds?: Record<string, LearnItemKind>
  acquisitionStates?: Record<string, LearnAcquisitionState>
  optionalNewWords?: Array<{ name: string }>
}

export function countLearnSessionAcquisitionWords(
  snapshot: LearnSessionCohortSnapshot,
): number {
  const names = new Set<string>()
  const optional = new Set(snapshot.optionalNewWords?.map(word => word.name))

  for (const name of Object.keys(snapshot.acquisitionStates ?? {})) {
    if (optional.has(name)) continue
    if (!snapshot.acquisitionStates?.[name].spacingOnly) names.add(name)
  }

  if (snapshot.sessionKind === 'acquisition') {
    for (const word of snapshot.words) {
      if (word?.name && !optional.has(word.name) && !snapshot.acquisitionStates?.[word.name]?.spacingOnly) names.add(word.name)
    }
  } else if (snapshot.sessionKind === 'mixed') {
    for (const word of snapshot.words) {
      if (
        word?.name && !optional.has(word.name) &&
        snapshot.itemKinds?.[word.name] === 'acquisition' &&
        !snapshot.acquisitionStates?.[word.name]?.spacingOnly
      ) {
        names.add(word.name)
      }
    }
  }

  return names.size
}

export function countLearnSessionLogicalWords(
  snapshot: LearnSessionCohortSnapshot,
): number {
  return new Set(
    snapshot.words
      .filter(word => !snapshot.acquisitionStates?.[word.name]?.spacingOnly && !snapshot.optionalNewWords?.some(optional => optional.name === word.name))
      .map((word) => word?.name)
      .filter((name): name is string => Boolean(name)),
  ).size
}

export function shouldRotateOversizedLearnSession(
  snapshot: LearnSessionCohortSnapshot,
): boolean {
  if (snapshot.isFinished === true) return false

  // Review volume is not an acquisition cohort. A large due-review session
  // may legitimately contain more than 20 logical words and must never be
  // closed by the new-word compatibility guard.
  if (snapshot.sessionKind === 'review') return false

  // New checkpoints persist their chosen blockSize; older checkpoints did
  // not, and must retain the historical 20-word guard when recovering.
  // Using today's default of 10 here could rotate unfinished legacy work.
  const cohortLimit = snapshot.blockSize === undefined
    ? LEGACY_LEARN_BLOCK_SIZE
    : normalizeLearnBlockSize(snapshot.blockSize)
  if (snapshot.sessionKind === 'mixed') {
    return countLearnSessionAcquisitionWords(snapshot) > cohortLimit
  }

  // Explicit acquisition and metadata-less legacy checkpoints use the queue
  // as the conservative cohort signal. Repeated supported/independent
  // occurrences do not increase the logical-word count.
  return (
    countLearnSessionLogicalWords(snapshot) > cohortLimit
  )
}

export type LearnMixedSessionSelection = {
  selectedReviewWords: Word[]
  selectedAcquisitionWords: Word[]
  selectedWords: Word[]
  sessionKind: LearnSessionKind
  itemKinds: Record<string, LearnItemKind>
}

export function selectLearnMixedSessionItems(input: {
  dueWords: Word[]
  acquisitionWords: Word[]
  blockSize?: number
}): LearnMixedSessionSelection {
  const blockSize = normalizeLearnBlockSize(input.blockSize)
  const reservedAcquisitionSlots =
    input.dueWords.length > 0
      ? Math.min(
          LEARN_MIXED_NEW_WORD_RESERVE,
          input.acquisitionWords.length,
          blockSize - 1,
        )
      : 0
  const reviewSlotLimit = Math.max(
    0,
    blockSize - reservedAcquisitionSlots,
  )
  const selectedReviewWords = input.dueWords.slice(
    0,
    reviewSlotLimit,
  )
  const acquisitionSlotLimit = Math.max(
    0,
    blockSize - selectedReviewWords.length,
  )
  const selectedAcquisitionWords = input.acquisitionWords.slice(
    0,
    acquisitionSlotLimit,
  )
  const selectedWords = [
    ...selectedReviewWords,
    ...selectedAcquisitionWords,
  ]
  const hasReview = selectedReviewWords.length > 0
  const hasAcquisition = selectedAcquisitionWords.length > 0
  const sessionKind: LearnSessionKind =
    hasReview && hasAcquisition
      ? 'mixed'
      : hasAcquisition
        ? 'acquisition'
        : 'review'
  const itemKinds = Object.fromEntries([
    ...selectedReviewWords.map(
      (word) => [word.name, 'review' as const],
    ),
    ...selectedAcquisitionWords.map(
      (word) => [word.name, 'acquisition' as const],
    ),
  ])

  return {
    selectedReviewWords,
    selectedAcquisitionWords,
    selectedWords,
    sessionKind,
    itemKinds,
  }
}


/**
 * Learn owns one long-term spelling memory per exact dictionary name.
 *
 * Typing keeps the dictionary list unchanged, including repeated textbook
 * occurrences. Learn collapses repeated names at its boundary so one memory
 * item cannot be expanded into multiple session items. The first occurrence
 * keeps dictionary order while translations are merged for display.
 */
export function canonicalizeLearningWords(words: Word[]): Word[] {
  const canonical: Word[] = []
  const byName = new Map<string, Word>()

  for (const word of words) {
    if (!word?.name) continue

    const existing = byName.get(word.name)
    if (!existing) {
      const copy: Word = {
        ...word,
        trans: [...word.trans],
        ...(word.example !== undefined
          ? { example: word.example.map((example) => ({ ...example })) }
          : {}),
        ...(word.tags !== undefined ? { tags: [...word.tags] } : {}),
      }
      canonical.push(copy)
      byName.set(copy.name, copy)
      continue
    }

    for (const translation of word.trans) {
      if (!existing.trans.includes(translation)) {
        existing.trans.push(translation)
      }
    }

    if (word.example?.length) {
      existing.example ??= []
      for (const example of word.example) {
        const duplicate = existing.example.some(
          (item) =>
            item.en === example.en &&
            item.cn === example.cn &&
            item.start === example.start &&
            item.end === example.end,
        )
        if (!duplicate) existing.example.push({ ...example })
      }
    }

    if (word.tags?.length) {
      existing.tags = [...new Set([...(existing.tags ?? []), ...word.tags])]
    }

    if (!existing.usphone && word.usphone) existing.usphone = word.usphone
    if (!existing.ukphone && word.ukphone) existing.ukphone = word.ukphone
    if (!existing.notation && word.notation) existing.notation = word.notation
  }

  return canonical
}

/**
 * New Learn acquisition starts with a confidence-building visible exposure.
 * The Learn-only controller later swaps this frozen plan to Supported and
 * Independent phases without changing ordinary Typing policy.
 */
export function createLearnAcquisitionPlan(options?: {
  scaffoldStrainTier?: LearnInteractionStrainTier
}): ReviewExercisePlanV1 {
  return createLearnAcquisitionExercisePlanForState(
    createLearnAcquisitionState(options),
  )
}

export function buildLearnAcquisitionExercisePlans(
  words: Word[],
  options?: { scaffoldStrainTier?: LearnInteractionStrainTier },
): Record<string, ReviewExercisePlanV1> {
  return Object.fromEntries(
    words.map((word) => [
      word.name,
      createLearnAcquisitionPlan(options),
    ]),
  )
}

export function buildLearnAcquisitionStates(
  words: Word[],
  options?: { scaffoldStrainTier?: LearnInteractionStrainTier },
): Record<string, LearnAcquisitionState> {
  return Object.fromEntries(
    words.map((word) => [
      word.name,
      createLearnAcquisitionState(options),
    ]),
  )
}

/**
 * Dictionary order is the stable V1 acquisition order. Any existing
 * LearningState means the word has already been admitted or manually
 * excluded, so it is not UNSEEN.
 */
function collectUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
): Word[] {
  const knownWords = new Set(states.map((state) => state.word))
  const selected: Word[] = []
  const selectedNames = new Set<string>()

  for (const word of canonicalizeLearningWords(words)) {
    if (
      knownWords.has(word.name) ||
      selectedNames.has(word.name)
    ) {
      continue
    }

    selected.push(word)
    selectedNames.add(word.name)
  }

  return selected
}

export function selectUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
): Word[] {
  if (limit <= 0) return []
  return collectUnseenLearningWords(words, states).slice(0, limit)
}

export function countUnseenLearningWords(
  words: Word[],
  states: IReviewWordState[],
): number {
  return collectUnseenLearningWords(words, states).length
}


export type LearnAcquisitionCandidatePlan = {
  resumed: Array<{
    word: Word
    state: LearnAcquisitionState
  }>
  freshWords: Word[]
  blockedPendingWords: string[]
}

export function planLearnAcquisitionCandidates(input: {
  words: Word[]
  states: IReviewWordState[]
  pendingStates: Map<string, LearnAcquisitionState>
  introducedWords: Iterable<string>
  freshLimit: number
  blockSize?: number
  now: number
  continuous?: boolean
  /** Actual remaining due-review candidates available for legitimate interleaving. */
  spacingCandidateNames?: Iterable<string>
  allowedNewWordNames?: Iterable<string>
  /** Restrict all pending Acquisition (including terminal tails) to this day. */
  allowedAcquisitionNames?: Iterable<string>
  allowTerminalProbeOnIdle?: boolean
}): LearnAcquisitionCandidatePlan {
  const blockSize = normalizeLearnBlockSize(input.blockSize)
  const canonicalWords = canonicalizeLearningWords(input.words)
  const canonicalByName = new Map(
    canonicalWords.map((word) => [word.name, word]),
  )
  const resumed: LearnAcquisitionCandidatePlan['resumed'] = []
  const allowedAcquisitionNames = input.allowedAcquisitionNames === undefined
    ? undefined : new Set(input.allowedAcquisitionNames)
  const cohortTimes = deferredAcquisitionCohortResumeTimes(
    new Map([...input.pendingStates].filter(([name]) => canonicalByName.has(name))),
  )

  const spacingCandidateNames = input.spacingCandidateNames === undefined
    ? undefined : new Set(input.spacingCandidateNames)
  const canContinue =
    input.continuous &&
    selectLearnSpacingWords({
      words: spacingCandidateNames
        ? canonicalWords.filter((word) => spacingCandidateNames.has(word.name))
        : canonicalWords,
      states: input.states,
      excludedNames: input.pendingStates.keys(),
    }).length >= 2

  for (const [wordName, pendingState] of input.pendingStates) {
    if (resumed.length >= blockSize) break
    if (allowedAcquisitionNames && !allowedAcquisitionNames.has(wordName)) continue
    if (pendingState.terminalProbeAttemptedAt !== undefined &&
        learnLocalDateKey(pendingState.terminalProbeAttemptedAt) === learnLocalDateKey(input.now)) continue

    if (!canContinue && (cohortTimes.get(wordName) ?? input.now) > input.now) continue

    const resumedState =
      pendingState.phase === 'deferred'
        ? canContinue
          ? {
              ...pendingState,
              phase: 'supported' as const,
              independentInterveningItems: undefined,
              deferredReason: undefined,
              resumeAfter: undefined,
            }
          : resumeDeferredAcquisition(pendingState, input.now)
        : pendingState.phase === 'complete'
          ? undefined
          : pendingState

    const word = canonicalByName.get(wordName)
    if (!resumedState || !word) continue
    resumed.push({ word, state: resumedState })
  }

  const blockedPendingWords = [...input.pendingStates.keys()]
  const blockedNames = new Set(blockedPendingWords)
  const introducedNames = new Set(input.introducedWords)
  const allowedFreshNames = input.allowedNewWordNames === undefined
    ? undefined
    : new Set(input.allowedNewWordNames)
  const freshCapacity = Math.min(
    Math.max(0, Math.floor(input.freshLimit)),
    Math.max(0, blockSize - resumed.length),
  )
  const freshWords =
    freshCapacity > 0
      ? selectUnseenLearningWords(
          canonicalWords,
          input.states,
          Number.MAX_SAFE_INTEGER,
        )
          .filter(
            (word) =>
              !blockedNames.has(word.name) &&
              !introducedNames.has(word.name) &&
              (allowedFreshNames === undefined || allowedFreshNames.has(word.name)),
          )
          .slice(0, freshCapacity)
      : []

  // No other due or unintroduced work: one hidden independent terminal
  // probe per deferred word, without pretending a clock or intervening word passed.
  if (input.allowTerminalProbeOnIdle && resumed.length === 0 && freshWords.length === 0) {
    for (const [name, state] of input.pendingStates) {
      if (resumed.length >= blockSize) break
      if (state.phase !== 'deferred') continue
      if (allowedAcquisitionNames && !allowedAcquisitionNames.has(name)) continue
      if (state.terminalProbeAttemptedAt !== undefined &&
          learnLocalDateKey(state.terminalProbeAttemptedAt) === learnLocalDateKey(input.now)) continue
      const word = canonicalByName.get(name)
      const probe = resumeDeferredAsTerminalProbe(state)
      if (word && probe) resumed.push({ word, state: probe })
    }
  }

  return {
    resumed,
    freshWords,
    blockedPendingWords,
  }
}


export type LearnStartKind =
  | 'review'
  | 'acquisition'
  | 'mixed'
  | 'empty'

/**
 * Product-level Start semantics: Review keeps priority, but due work no longer
 * acts as a hard gate against new-word admission.
 */
export function decideLearnStartKind(input: {
  dueCount: number
  unseenCount: number
}): LearnStartKind {
  if (input.dueCount > 0 && input.unseenCount > 0) return 'mixed'
  if (input.dueCount > 0) return 'review'
  if (input.unseenCount > 0) return 'acquisition'
  return 'empty'
}

/** Already-admitted, non-excluded words only: practice adds no fresh workload. */
export function selectLearnSpacingWords(input: {
  words: Word[]
  states: IReviewWordState[]
  excludedNames: Iterable<string>
}): Word[] {
  const excluded = new Set(input.excludedNames)
  const active = new Set(
    input.states
      .filter((state) => state.lifecycle !== 'excluded')
      .map((state) => state.word),
  )
  return canonicalizeLearningWords(input.words)
    .filter((word) => active.has(word.name) && !excluded.has(word.name))
    .slice(0, 2)
}
