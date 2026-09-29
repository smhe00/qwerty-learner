import { summarizeWordHistory } from './features'
import type { WordHistorySummary } from './features'
import { buildOrthographyProfile } from './profile'
import type { OrthographyProfile } from './profile'
import { db } from '@/utils/db'
import type { IWordRecord } from '@/utils/db/record'

/**
 * Load historical evidence for one word in one dictionary.
 * Uses the existing word index, then applies dictionary filtering.
 */
export type WordReviewHistory = {
  records: IWordRecord[]
  summary: WordHistorySummary
  orthography: OrthographyProfile
}

export async function loadWordReviewHistory(
  dict: string,
  word: string,
): Promise<WordReviewHistory> {
  const records = await db.wordRecords
    .where('word')
    .equals(word)
    .and((record) => record.dict === dict)
    .toArray()

  return {
    records,
    summary: summarizeWordHistory(records),
    orthography: buildOrthographyProfile(word, records),
  }
}

export async function loadWordHistorySummary(
  dict: string,
  word: string,
): Promise<WordHistorySummary> {
  return (await loadWordReviewHistory(dict, word)).summary
}
