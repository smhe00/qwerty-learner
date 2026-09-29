import { db } from '.'
import { ReviewRecord } from './record'
import type { TErrorWordData } from '@/pages/Gallery-N/hooks/useErrorWords'
import { filterDueReviewCandidates } from '@/review/due'
import { buildReviewSessionExercisePlans } from '@/review/session'
import { rankDueReviewCandidates } from '@/review/priority'
import { bootstrapReviewWordStatesForDictionary, getDueReviewWordStates } from '@/review/repository'
import type { Word } from '@/typings'
import { getUTCUnixTimestamp } from '@/utils'
import { useEffect, useState } from 'react'

export function useGetLatestReviewRecord(dictID: string) {
  const [wordReviewRecord, setWordReviewRecord] = useState<ReviewRecord | undefined>(undefined)
  useEffect(() => {
    const fetchWordReviewRecords = async () => {
      const record = await getReviewRecords(dictID)
      setWordReviewRecord(record)
    }
    if (dictID) {
      fetchWordReviewRecords()
    }
  }, [dictID])
  return wordReviewRecord
}

async function getReviewRecords(dictID: string): Promise<ReviewRecord | undefined> {
  const records = await db.reviewRecords.where('dict').equals(dictID).toArray()

  const latestRecord = records.sort((a, b) => a.createTime - b.createTime).pop()

  return latestRecord && (latestRecord.isFinished ? undefined : latestRecord)
}

export async function generateNewWordReviewRecord(dictID: string, errorData: TErrorWordData[]) {
  await bootstrapReviewWordStatesForDictionary(dictID)

  const dueStates = await getDueReviewWordStates(dictID, getUTCUnixTimestamp())
  const dueErrorData = filterDueReviewCandidates(errorData, dueStates)
  const sortedWords: Word[] = rankDueReviewCandidates(dueErrorData, dueStates).map((item) => item.originData)

  if (sortedWords.length === 0) {
    return undefined
  }

  const wordRecords = await db.wordRecords.where('dict').equals(dictID).toArray()
  const exercisePlans = buildReviewSessionExercisePlans(sortedWords, wordRecords)
  const record = new ReviewRecord(dictID, sortedWords, exercisePlans)

  await db.reviewRecords.put(record)
  return record
}

export async function putWordReviewRecord(record: ReviewRecord) {
  db.reviewRecords.put(record)
}
