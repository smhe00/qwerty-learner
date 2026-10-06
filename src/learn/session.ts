import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  createLearnAcquisitionExercisePlanForState,
  createLearnAcquisitionState,
  resumeDeferredAcquisition,
} from './acquisition'
import type { LearnAcquisitionState } from './acquisition'
import type { LearnInteractionStrainTier } from './strain'
import type { ReviewExercisePlanV1 } from '@/review/decision'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'

export const LEARN_ACQUISITION_POLICY_VERSION =
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION
export const LEARN_NEW_WORD_BATCH_SIZE = 20
export const LEARN_SESSION_TARGET_SIZE = 20
export const LEARN_MIXED_NEW_WORD_RESERVE = 5

export type LearnItemKind = 'review' | 'acquisition'
export type LearnSessionKind = LearnItemKind | 'mixed'

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
  sessionKind?: LearnSessionKind
  words: Array<{ name: string }>
  itemKinds?: Record<string, LearnItemKind>
  acquisitionStates?: Record<string, LearnAcquisitionState>
}

export function countLearnSessionAcquisitionWords(
  snapshot: LearnSessionCohortSnapshot,
): number {
  const names = new Set<string>()

  for (const name of Object.keys(snapshot.acquisitionStates ?? {})) {
    names.add(name)
  }

  if (snapshot.sessionKind === 'acquisition') {
    for (const word of snapshot.words) {
      if (word?.name) names.add(word.name)
    }
  } else if (snapshot.sessionKind === 'mixed') {
    for (const word of snapshot.words) {
      if (
        word?.name &&
        snapshot.itemKinds?.[word.name] === 'acquisition'
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

  if (snapshot.sessionKind === 'mixed') {
    return (
      countLearnSessionAcquisitionWords(snapshot) >
      LEARN_SESSION_TARGET_SIZE
    )
  }

  // Explicit acquisition and metadata-less legacy checkpoints use the queue
  // as the conservative cohort signal. Repeated supported/independent
  // occurrences do not increase the logical-word count.
  return (
    countLearnSessionLogicalWords(snapshot) >
    LEARN_SESSION_TARGET_SIZE
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
}): LearnMixedSessionSelection {
  const reservedAcquisitionSlots =
    input.dueWords.length > 0
      ? Math.min(
          LEARN_MIXED_NEW_WORD_RESERVE,
          input.acquisitionWords.length,
        )
      : 0
  const reviewSlotLimit = Math.max(
    0,
    LEARN_SESSION_TARGET_SIZE - reservedAcquisitionSlots,
  )
  const selectedReviewWords = input.dueWords.slice(
    0,
    reviewSlotLimit,
  )
  const acquisitionSlotLimit = Math.max(
    0,
    LEARN_SESSION_TARGET_SIZE - selectedReviewWords.length,
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
  now: number
}): LearnAcquisitionCandidatePlan {
  const canonicalWords = canonicalizeLearningWords(input.words)
  const canonicalByName = new Map(
    canonicalWords.map((word) => [word.name, word]),
  )
  const resumed: LearnAcquisitionCandidatePlan['resumed'] = []

  for (const [wordName, pendingState] of input.pendingStates) {
    if (resumed.length >= LEARN_NEW_WORD_BATCH_SIZE) break

    const resumedState =
      pendingState.phase === 'deferred'
        ? resumeDeferredAcquisition(pendingState, input.now)
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
  const freshCapacity = Math.min(
    Math.max(0, Math.floor(input.freshLimit)),
    Math.max(0, LEARN_NEW_WORD_BATCH_SIZE - resumed.length),
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
              !introducedNames.has(word.name),
          )
          .slice(0, freshCapacity)
      : []

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
