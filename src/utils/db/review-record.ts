import { db } from '.'
import {
  LEARN_NEW_WORD_BATCH_SIZE,
  buildLearnAcquisitionExercisePlans,
  canonicalizeLearningWords,
  selectUnseenLearningWords,
} from '@/learn/session'
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

export async function generateNewWordAcquisitionRecord(
  dictID: string,
  words: Word[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
) {
  const states = await getReviewWordStates(dictID)
  const selectedWords = selectUnseenLearningWords(words, states, limit)

  if (selectedWords.length === 0) return undefined

  const exercisePlans = buildLearnAcquisitionExercisePlans(selectedWords)
  const record = new ReviewRecord(
    dictID,
    selectedWords,
    exercisePlans,
    'acquisition',
  )
  record.id = await db.reviewRecords.add(record)
  return record
}
