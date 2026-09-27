import { summarizeWordHistory } from './features'
import type { WordHistorySummary } from './features'
import { db } from '@/utils/db'

/**
 * Load historical evidence for one word in one dictionary.
 * Uses the existing word index, then applies dictionary filtering.
 */
export async function loadWordHistorySummary(dict: string, word: string): Promise<WordHistorySummary> {
  const records = await db.wordRecords
    .where('word')
    .equals(word)
    .and((record) => record.dict === dict)
    .toArray()

  return summarizeWordHistory(records)
}
