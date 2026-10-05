import { db } from '.'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { isAcquisitionIntroductionRecord } from '@/learn/admission'
import {
  LEARN_MIXED_NEW_WORD_RESERVE,
  LEARN_NEW_WORD_BATCH_SIZE,
  LEARN_SESSION_TARGET_SIZE,
  buildLearnAcquisitionExercisePlans,
  buildLearnAcquisitionStates,
  canonicalizeLearningWords,
  planLearnAcquisitionCandidates,
  shouldRotateOversizedLearnSession,
} from '@/learn/session'
import {
  createLearnAcquisitionExercisePlanForState,
  normalizeDeferredAcquisitionState,
} from '@/learn/acquisition'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import {
  sanitizeLearnSessionLifecycle,
} from '@/learn/lifecycle'
import { estimateLearnInteractionStrain } from '@/learn/strain'
import { ReviewRecord } from './record'
import type { TErrorWordData } from '@/pages/Gallery-N/hooks/useErrorWords'
import { selectReviewCandidates } from '@/review/due'
import type { ReviewSelectionMode } from '@/review/due'
import { buildReviewSessionExercisePlans } from '@/review/session'
import { rankDueReviewCandidates } from '@/review/priority'
import {
  bootstrapReviewWordStatesForDictionary,
  getReviewWordStates,
} from '@/review/repository'
import type { Word } from '@/typings'
import { getUTCUnixTimestamp } from '@/utils'
import { useEffect, useState } from 'react'

export function useGetLatestReviewRecord(dictID: string) {
  const [wordReviewRecord, setWordReviewRecord] = useState<ReviewRecord | undefined>(undefined)
  useEffect(() => {
    const fetchWordReviewRecords = async () => {
      const record = await getLatestReviewRecord(dictID)
      setWordReviewRecord(record)
    }
    if (dictID) {
      fetchWordReviewRecords()
    }
  }, [dictID])
  return wordReviewRecord
}

export async function getLatestReviewRecord(dictID: string): Promise<ReviewRecord | undefined> {
  const records = await db.reviewRecords.where('dict').equals(dictID).toArray()

  // Session recovery is about the newest unfinished checkpoint, not the
  // newest historical record. A newer finished session must never hide an
  // older still-unfinished session.
  const latest = records
    .filter((record) => !record.isFinished)
    .sort((a, b) => a.createTime - b.createTime)
    .pop()

  if (!latest) return undefined

  // Checkpoint recovery is lifecycle-owned. Review keeps only ACTIVE words.
  // Acquisition keeps only words with no persistent lifecycle state, so a
  // checkpoint written just before admission/exclusion cannot replay work
  // that has already crossed the lifecycle boundary.
  const states = await getReviewWordStates(dictID)
  const sanitized = sanitizeLearnSessionLifecycle(
    latest,
    states,
  ) as ReviewRecord

  if (sanitized !== latest && latest.id !== undefined) {
    await putWordReviewRecord(sanitized)
  }

  if (shouldRotateOversizedLearnSession(sanitized)) {
    const rotated = {
      ...sanitized,
      isFinished: true,
    } as ReviewRecord
    await putWordReviewRecord(rotated)
    appendDeveloperTrace({
      scope: 'runtime',
      event: 'oversized-learn-session-rotated',
      sessionId: String(
        sanitized.id ?? sanitized.createTime,
      ),
      index: sanitized.index,
      queueLength: sanitized.words.length,
      details: {
        sessionKind: sanitized.sessionKind ?? 'legacy',
        reason: 'acquisition-cohort-over-20',
      },
    })
    return undefined
  }

  return sanitized.isFinished ? undefined : sanitized
}

export async function generateNewWordReviewRecord(
  dictID: string,
  errorData: TErrorWordData[],
  options?: { mode?: ReviewSelectionMode },
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const states = await getReviewWordStates(dictID)
  const selectedErrorData = selectReviewCandidates(
    errorData,
    states,
    now,
    options?.mode ?? 'due',
  )
  const sortedWords: Word[] = rankDueReviewCandidates(
    selectedErrorData,
    states,
  ).map((item) => item.originData)

  if (sortedWords.length === 0) return undefined

  const wordRecords = await db.wordRecords.where('dict').equals(dictID).toArray()
  const exercisePlans = buildReviewSessionExercisePlans(sortedWords, wordRecords)
  const record = new ReviewRecord(dictID, sortedWords, exercisePlans)
  record.id = await db.reviewRecords.add(record)
  return record
}

export async function putWordReviewRecord(record: ReviewRecord) {
  const id = await db.transaction(
    'rw',
    db.reviewRecords,
    async () => {
      if (record.id !== undefined) {
        const existing = await db.reviewRecords.get(record.id)
        if (existing?.isFinished && !record.isFinished) {
          return record.id
        }
      }
      return db.reviewRecords.put(record)
    },
  )

  appendDeveloperTrace({
    scope: 'persistence',
    event: 'review-checkpoint-durable',
    sessionId: String(record.id ?? record.createTime),
    index: record.index,
    queueLength: record.words.length,
    details: {
      isFinished: record.isFinished,
    },
  })

  return id
}


export async function generateLearnReviewRecord(
  dictID: string,
  words: Word[],
  errorData: TErrorWordData[],
  options?: { mode?: ReviewSelectionMode },
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const states = await getReviewWordStates(dictID)
  const errorByWord = new Map(
    errorData.map((item) => [item.word, item]),
  )

  const candidates = canonicalizeLearningWords(words).map((originData) => {
    const error = errorByWord.get(originData.name)
    return {
      word: originData.name,
      originData,
      errorCount: error?.errorCount ?? 0,
      latestErrorTime: error?.latestErrorTime ?? 0,
    }
  })

  const selected = selectReviewCandidates(
    candidates,
    states,
    now,
    options?.mode ?? 'due',
  )

  const sortedWords: Word[] = rankDueReviewCandidates(
    selected,
    states,
  ).map((item) => item.originData)

  if (sortedWords.length === 0) return undefined

  const wordRecords = await db.wordRecords.where('dict').equals(dictID).toArray()
  const exercisePlans = buildReviewSessionExercisePlans(sortedWords, wordRecords)
  const record = new ReviewRecord(
    dictID,
    sortedWords,
    exercisePlans,
    'review',
  )
  if ((options?.mode ?? 'due') === 'due') {
    record.recommendedGoal = {
      version: 1,
      kind: 'session-completion',
      targetUniqueWords: new Set(
        sortedWords.map((word) => word.name),
      ).size,
    }
  }
  record.id = await db.reviewRecords.add(record)
  return record
}

export async function generateLearnMixedSessionRecord(
  dictID: string,
  words: Word[],
  errorData: TErrorWordData[],
  freshLimit = LEARN_NEW_WORD_BATCH_SIZE,
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const [states, pending, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    getPendingAcquisitionStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])

  const errorByWord = new Map(
    errorData.map((item) => [item.word, item]),
  )
  const reviewCandidates = canonicalizeLearningWords(words).map(
    (originData) => {
      const error = errorByWord.get(originData.name)
      return {
        word: originData.name,
        originData,
        errorCount: error?.errorCount ?? 0,
        latestErrorTime: error?.latestErrorTime ?? 0,
      }
    },
  )
  const dueWords = rankDueReviewCandidates(
    selectReviewCandidates(
      reviewCandidates,
      states,
      now,
      'due',
    ),
    states,
  ).map((item) => item.originData)

  const candidatePlan = planLearnAcquisitionCandidates({
    words,
    states,
    pendingStates: pending,
    introducedWords: wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word),
    freshLimit: Math.max(0, Math.floor(freshLimit)),
    now,
  })
  const acquisitionCandidates = [
    ...candidatePlan.resumed.map(({ word, state }) => ({
      word,
      state,
      resumed: true as const,
    })),
    ...candidatePlan.freshWords.map((word) => ({
      word,
      state: undefined,
      resumed: false as const,
    })),
  ]

  const reservedAcquisitionSlots =
    dueWords.length > 0
      ? Math.min(
          LEARN_MIXED_NEW_WORD_RESERVE,
          acquisitionCandidates.length,
        )
      : 0
  const reviewSlotLimit = Math.max(
    0,
    LEARN_SESSION_TARGET_SIZE - reservedAcquisitionSlots,
  )
  const selectedReviewWords = dueWords.slice(0, reviewSlotLimit)
  const acquisitionSlotLimit = Math.max(
    0,
    LEARN_SESSION_TARGET_SIZE - selectedReviewWords.length,
  )
  const selectedAcquisition = acquisitionCandidates.slice(
    0,
    acquisitionSlotLimit,
  )
  const selectedAcquisitionWords = selectedAcquisition.map(
    (item) => item.word,
  )
  const selectedWords = [
    ...selectedReviewWords,
    ...selectedAcquisitionWords,
  ]

  if (selectedWords.length === 0) return undefined

  const scaffoldStrainTier =
    estimateLearnInteractionStrain(wordRecords).tier
  const freshWords = selectedAcquisition
    .filter((item) => !item.resumed)
    .map((item) => item.word)
  const resumed = selectedAcquisition.filter(
    (item): item is typeof item & {
      state: LearnAcquisitionState
      resumed: true
    } => item.resumed && item.state !== undefined,
  )

  const reviewPlans = buildReviewSessionExercisePlans(
    selectedReviewWords,
    wordRecords,
  )
  const acquisitionPlans = {
    ...buildLearnAcquisitionExercisePlans(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [
        word.name,
        createLearnAcquisitionExercisePlanForState(state),
      ]),
    ),
  }
  const acquisitionStates = {
    ...buildLearnAcquisitionStates(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [word.name, state]),
    ),
  }

  const hasReview = selectedReviewWords.length > 0
  const hasAcquisition = selectedAcquisitionWords.length > 0
  const sessionKind =
    hasReview && hasAcquisition
      ? 'mixed'
      : hasAcquisition
        ? 'acquisition'
        : 'review'

  const record = new ReviewRecord(
    dictID,
    selectedWords,
    {
      ...reviewPlans,
      ...acquisitionPlans,
    },
    sessionKind,
  )
  record.itemKinds = Object.fromEntries([
    ...selectedReviewWords.map(
      (word) => [word.name, 'review' as const],
    ),
    ...selectedAcquisitionWords.map(
      (word) => [word.name, 'acquisition' as const],
    ),
  ])
  if (hasAcquisition) {
    record.acquisitionStates = acquisitionStates
  }
  record.recommendedGoal = {
    version: 1,
    kind: 'session-completion',
    targetUniqueWords: new Set(
      selectedWords.map((word) => word.name),
    ).size,
  }
  record.id = await db.reviewRecords.add(record)
  return record
}


function latestAcquisitionStatesByWord(
  records: ReviewRecord[],
): Map<string, LearnAcquisitionState> {
  const latest = new Map<string, LearnAcquisitionState>()

  for (const record of [...records].sort(
    (left, right) => left.createTime - right.createTime,
  )) {
    if (
      record.sessionKind !== 'acquisition' &&
      record.sessionKind !== 'mixed'
    ) {
      continue
    }
    for (const [word, state] of Object.entries(
      record.acquisitionStates ?? {},
    )) {
      latest.set(
        word,
        normalizeDeferredAcquisitionState(
          state,
          record.createTime,
        ),
      )
    }
  }

  return latest
}

async function getPendingAcquisitionStates(
  dictID: string,
): Promise<Map<string, LearnAcquisitionState>> {
  const [records, states] = await Promise.all([
    db.reviewRecords.where('dict').equals(dictID).toArray(),
    getReviewWordStates(dictID),
  ])
  const admitted = new Set(states.map((state) => state.word))
  const latest = latestAcquisitionStatesByWord(records)
  const pending = new Map<string, LearnAcquisitionState>()

  for (const [word, state] of latest) {
    if (admitted.has(word) || state.phase === 'complete') continue
    pending.set(word, state)
  }

  return pending
}

async function getDeferredAcquisitionStates(
  dictID: string,
): Promise<Map<string, LearnAcquisitionState>> {
  const pending = await getPendingAcquisitionStates(dictID)
  return new Map(
    [...pending].filter(
      ([, state]) =>
        state.phase === 'deferred' &&
        state.resumeAfter !== undefined,
    ),
  )
}

export async function getNextDeferredAcquisitionResumeAt(
  dictID: string,
): Promise<number | undefined> {
  const deferred = await getDeferredAcquisitionStates(dictID)
  const resumeTimes = [...deferred.values()]
    .map((state) => state.resumeAfter)
    .filter((value): value is number => value !== undefined)

  return resumeTimes.length > 0 ? Math.min(...resumeTimes) : undefined
}

/**
 * Compatibility alias. Pending recovery now includes both spacing and
 * assistance deferrals.
 */
export async function getNextSpacingDeferredResumeAt(
  dictID: string,
): Promise<number | undefined> {
  return getNextDeferredAcquisitionResumeAt(dictID)
}

export async function generateNewWordAcquisitionRecord(
  dictID: string,
  words: Word[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
) {
  const freshLimit = Math.max(0, Math.floor(limit))
  const now = getUTCUnixTimestamp()
  const [states, pending, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    getPendingAcquisitionStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])
  const scaffoldStrainTier =
    estimateLearnInteractionStrain(wordRecords).tier

  const candidatePlan = planLearnAcquisitionCandidates({
    words,
    states,
    pendingStates: pending,
    introducedWords: wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word),
    freshLimit,
    now,
  })
  const { resumed, freshWords } = candidatePlan

  const selectedWords = [
    ...resumed.map((item) => item.word),
    ...freshWords,
  ]
  if (selectedWords.length === 0) return undefined

  const exercisePlans = {
    ...buildLearnAcquisitionExercisePlans(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [
        word.name,
        createLearnAcquisitionExercisePlanForState(state),
      ]),
    ),
  }
  const acquisitionStates = {
    ...buildLearnAcquisitionStates(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [word.name, state]),
    ),
  }

  const record = new ReviewRecord(
    dictID,
    selectedWords,
    exercisePlans,
    'acquisition',
  )
  record.acquisitionStates = acquisitionStates
  record.recommendedGoal = {
    version: 1,
    kind: 'session-completion',
    targetUniqueWords: new Set(
      selectedWords.map((word) => word.name),
    ).size,
  }
  record.id = await db.reviewRecords.add(record)
  return record
}
