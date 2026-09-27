import type { IReviewWordState } from './types'
import { db } from '@/utils/db'

export async function getReviewWordState(dict: string, word: string): Promise<IReviewWordState | undefined> {
  return db.reviewWordStates.where('[dict+word]').equals([dict, word]).first()
}

export async function upsertReviewWordState(state: IReviewWordState): Promise<number> {
  return db.transaction('rw', db.reviewWordStates, async () => {
    const existing = await getReviewWordState(state.dict, state.word)
    return db.reviewWordStates.put({
      ...state,
      id: existing?.id ?? state.id,
    })
  })
}

export async function getDueReviewWordStates(dict: string, now: number): Promise<IReviewWordState[]> {
  return db.reviewWordStates.where('[dict+nextReviewAt]').between([dict, 0], [dict, now], true, true).toArray()
}

export async function deleteReviewWordState(dict: string, word: string): Promise<void> {
  const existing = await getReviewWordState(dict, word)
  if (existing?.id !== undefined) {
    await db.reviewWordStates.delete(existing.id)
  }
}
