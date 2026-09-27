import { rebuildBasicStateFromLegacy, scheduleBasicReview } from './scheduler'
import { createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
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


export async function applyReviewOutcome(
  dict: string,
  word: string,
  outcome: ReviewOutcome,
  now: number,
  currentWordRecordId?: number,
): Promise<IReviewWordState> {
  return db.transaction('rw', db.wordRecords, db.reviewWordStates, async () => {
    const existing = await getReviewWordState(dict, word)
    let current = existing

    if (!current) {
      const priorRecords = await db.wordRecords
        .where('word')
        .equals(word)
        .and((record) => record.dict === dict && record.id !== currentWordRecordId)
        .toArray()

      current =
        rebuildBasicStateFromLegacy(dict, word, priorRecords) ??
        createInitialReviewWordState(dict, word, now)
    }

    if (current.schedulerState.kind !== 'basic-v1') {
      return current
    }

    const next = scheduleBasicReview({
      state: current,
      outcome,
      now,
    })

    const id = await db.reviewWordStates.put({
      ...next,
      id: existing?.id ?? next.id,
    })

    return { ...next, id }
  })
}

export async function bootstrapReviewWordStatesForDictionary(dict: string): Promise<number> {
  return db.transaction('rw', db.wordRecords, db.reviewWordStates, async () => {
    const [records, existingStates] = await Promise.all([
      db.wordRecords.where('dict').equals(dict).toArray(),
      db.reviewWordStates.where('dict').equals(dict).toArray(),
    ])

    const existingWords = new Set(existingStates.map((state) => state.word))
    const recordsByWord = new Map<string, typeof records>()

    for (const record of records) {
      if (existingWords.has(record.word)) continue
      const group = recordsByWord.get(record.word)
      if (group) {
        group.push(record)
      } else {
        recordsByWord.set(record.word, [record])
      }
    }

    let createdCount = 0

    for (const [word, wordRecords] of recordsByWord) {
      const state = rebuildBasicStateFromLegacy(dict, word, wordRecords)
      if (!state) continue

      await db.reviewWordStates.put(state)
      createdCount += 1
    }

    return createdCount
  })
}
