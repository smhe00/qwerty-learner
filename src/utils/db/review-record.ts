import { db } from '.'
import {
  LEARN_NEW_WORD_BATCH_SIZE,
  buildLearnAcquisitionExercisePlans,
  buildLearnAcquisitionStates,
  canonicalizeLearningWords,
  selectUnseenLearningWords,
} from '@/learn/session'
import {
  createLearnAcquisitionExercisePlanForState,
  resumeSpacingDeferredAcquisition,
} from '@/learn/acquisition'
import type { LearnAcquisitionState } from '@/learn/acquisition'
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
  return records
    .filter((record) => !record.isFinished)
    .sort((a, b) => a.createTime - b.createTime)
    .pop()
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
  return db.transaction('rw', db.reviewRecords, async () => {
    if (record.id !== undefined) {
      const existing = await db.reviewRecords.get(record.id)
      if (existing?.isFinished && !record.isFinished) {
        return record.id
      }
    }
    return db.reviewRecords.put(record)
  })
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
    if (record.sessionKind !== 'acquisition') continue
    for (const [word, state] of Object.entries(
      record.acquisitionStates ?? {},
    )) {
      latest.set(word, state)
    }
  }

  return latest
}

async function getSpacingDeferredAcquisitionStates(
  dictID: string,
): Promise<Map<string, LearnAcquisitionState>> {
  const [records, states] = await Promise.all([
    db.reviewRecords.where('dict').equals(dictID).toArray(),
    getReviewWordStates(dictID),
  ])
  const admitted = new Set(states.map((state) => state.word))
  const latest = latestAcquisitionStatesByWord(records)
  const deferred = new Map<string, LearnAcquisitionState>()

  for (const [word, state] of latest) {
    if (admitted.has(word)) continue
    if (
      state.phase === 'deferred' &&
      state.deferredReason === 'spacing' &&
      state.resumeAfter !== undefined
    ) {
      deferred.set(word, state)
    }
  }

  return deferred
}

export async function getNextSpacingDeferredResumeAt(
  dictID: string,
): Promise<number | undefined> {
  const deferred = await getSpacingDeferredAcquisitionStates(dictID)
  const resumeTimes = [...deferred.values()]
    .map((state) => state.resumeAfter)
    .filter((value): value is number => value !== undefined)

  return resumeTimes.length > 0 ? Math.min(...resumeTimes) : undefined
}

export async function generateNewWordAcquisitionRecord(
  dictID: string,
  words: Word[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
) {
  if (limit <= 0) return undefined

  const now = getUTCUnixTimestamp()
  const [states, deferred, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    getSpacingDeferredAcquisitionStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])
  const scaffoldStrainTier =
    estimateLearnInteractionStrain(wordRecords).tier

  const canonicalWords = canonicalizeLearningWords(words)
  const canonicalByName = new Map(
    canonicalWords.map((word) => [word.name, word]),
  )
  const resumed: Array<{
    word: Word
    state: LearnAcquisitionState
  }> = []

  for (const [wordName, deferredState] of deferred) {
    if (resumed.length >= limit) break
    const resumedState = resumeSpacingDeferredAcquisition(
      deferredState,
      now,
    )
    const word = canonicalByName.get(wordName)
    if (!resumedState || !word) continue
    resumed.push({ word, state: resumedState })
  }

  const blockedNames = new Set(deferred.keys())
  const remainingLimit = Math.max(0, limit - resumed.length)
  const freshWords =
    remainingLimit > 0
      ? selectUnseenLearningWords(
          canonicalWords,
          states,
          Number.MAX_SAFE_INTEGER,
        )
          .filter((word) => !blockedNames.has(word.name))
          .slice(0, remainingLimit)
      : []

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
  record.id = await db.reviewRecords.add(record)
  return record
}
