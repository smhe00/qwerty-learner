import {
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
} from './rebuild'
import {
  decideLearningLifecycleTransition,
  getLearningLifecycle,
  isActiveLearningState,
  pruneLearnSessionWord,
} from '@/learn/lifecycle'
import { scheduleBasicReview } from './scheduler'
import { CURRENT_REVIEW_STATE_VERSION, createInitialReviewWordState } from './types'
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

export async function getReviewWordStates(dict: string): Promise<IReviewWordState[]> {
  return db.reviewWordStates.where('dict').equals(dict).toArray()
}

export async function getDueReviewWordStates(dict: string, now: number): Promise<IReviewWordState[]> {
  const states = await db.reviewWordStates
    .where('[dict+nextReviewAt]')
    .between([dict, 0], [dict, now], true, true)
    .toArray()
  return states.filter(isActiveLearningState)
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

    if (existing && getLearningLifecycle(existing) === 'excluded') {
      return existing
    }

    let current = existing

    if (!current || current.stateVersion !== CURRENT_REVIEW_STATE_VERSION) {
      const priorRecords = await db.wordRecords
        .where('word')
        .equals(word)
        .and((record) => record.dict === dict && record.id !== currentWordRecordId)
        .toArray()

      current =
        rebuildBasicStateFromWordRecords(dict, word, priorRecords, { legacyDueAt: now }) ??
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

export async function bootstrapReviewWordStatesForDictionary(
  dict: string,
  legacyDueAt = Math.floor(Date.now() / 1000),
): Promise<number> {
  return db.transaction('rw', db.wordRecords, db.reviewWordStates, async () => {
    const [records, existingStates] = await Promise.all([
      db.wordRecords.where('dict').equals(dict).toArray(),
      db.reviewWordStates.where('dict').equals(dict).toArray(),
    ])

    const hasStaleState = existingStates.some(
      (state) => state.stateVersion !== CURRENT_REVIEW_STATE_VERSION,
    )
    if (hasStaleState) {
      await db.reviewWordStates.where('dict').equals(dict).delete()
    }

    const existingByWord = hasStaleState
      ? new Map<string, IReviewWordState>()
      : new Map(existingStates.map((state) => [state.word, state]))
    const recordsByWord = new Map<string, typeof records>()

    for (const record of records) {
      const group = recordsByWord.get(record.word)
      if (group) group.push(record)
      else recordsByWord.set(record.word, [record])
    }

    let changedCount = 0
    for (const [word, wordRecords] of recordsByWord) {
      const existing = existingByWord.get(word)
      if (existing) {
        const refreshed = reactivateReviewStateFromLearningEvidence(
          existing,
          wordRecords,
          legacyDueAt,
        )
        if (refreshed !== existing) {
          await db.reviewWordStates.put({ ...refreshed, id: existing.id })
          changedCount += 1
        }
        continue
      }

      const state = rebuildBasicStateFromWordRecords(dict, word, wordRecords, {
        legacyDueAt,
      })
      if (!state) continue
      await db.reviewWordStates.put(state)
      changedCount += 1
    }
    return changedCount
  })
}

export async function rebuildReviewWordStatesForDictionary(
  dict: string,
  legacyDueAt = Math.floor(Date.now() / 1000),
): Promise<number> {
  return db.transaction('rw', db.wordRecords, db.reviewWordStates, async () => {
    const [records, previousStates] = await Promise.all([
      db.wordRecords.where('dict').equals(dict).toArray(),
      db.reviewWordStates.where('dict').equals(dict).toArray(),
    ])
    const previousByWord = new Map(
      previousStates.map((state) => [state.word, state]),
    )
    const recordsByWord = new Map<string, typeof records>()

    for (const record of records) {
      const group = recordsByWord.get(record.word)
      if (group) {
        group.push(record)
      } else {
        recordsByWord.set(record.word, [record])
      }
    }

    await db.reviewWordStates.where('dict').equals(dict).delete()

    let rebuiltCount = 0
    for (const [word, wordRecords] of recordsByWord) {
      let state = rebuildBasicStateFromWordRecords(dict, word, wordRecords, { legacyDueAt })
      if (!state) continue

      const previous = previousByWord.get(word)
      if (previous && getLearningLifecycle(previous) === 'excluded') {
        state = {
          ...state,
          lifecycle: 'excluded',
          exclusion: previous.exclusion,
        }
      }

      await db.reviewWordStates.put(state)
      rebuiltCount += 1
    }

    return rebuiltCount
  })
}


export async function excludeLearningWord(
  dict: string,
  word: string,
  now = Math.floor(Date.now() / 1000),
): Promise<IReviewWordState> {
  return db.transaction(
    'rw',
    db.reviewWordStates,
    db.reviewRecords,
    async () => {
      const existing =
        (await getReviewWordState(dict, word)) ??
        createInitialReviewWordState(dict, word, now)

      const next = decideLearningLifecycleTransition(existing, {
        kind: 'exclude',
        now,
      })
      const id = await db.reviewWordStates.put({
        ...next,
        id: existing.id,
      })

      const unfinished = await db.reviewRecords
        .where('dict')
        .equals(dict)
        .filter((record) => !record.isFinished)
        .toArray()

      for (const record of unfinished) {
        const pruned = pruneLearnSessionWord(record, word)
        if (pruned !== record && record.id !== undefined) {
          await db.reviewRecords.put({ ...pruned, id: record.id })
        }
      }

      return { ...next, id }
    },
  )
}

export async function restoreLearningWord(
  dict: string,
  word: string,
  now = Math.floor(Date.now() / 1000),
): Promise<IReviewWordState | undefined> {
  return db.transaction('rw', db.reviewWordStates, async () => {
    const existing = await getReviewWordState(dict, word)
    if (!existing) return undefined

    const next = decideLearningLifecycleTransition(existing, {
      kind: 'restore',
      now,
    })
    if (next === existing) return existing

    const id = await db.reviewWordStates.put({
      ...next,
      id: existing.id,
    })
    return { ...next, id }
  })
}


export async function completeLearningAcquisition(
  dict: string,
  word: string,
  now = Math.floor(Date.now() / 1000),
): Promise<IReviewWordState> {
  return db.transaction('rw', db.reviewWordStates, async () => {
    const existing = await getReviewWordState(dict, word)

    // Acquisition is only for UNSEEN words. Repeated same-session training
    // must be idempotent, and manual exclusion must never be overwritten.
    if (existing) return existing

    const next = {
      ...createInitialReviewWordState(dict, word, now),
      lifecycle: 'active' as const,
      nextReviewAt: now + 86_400,
      updatedAt: now,
    }

    const id = await db.reviewWordStates.put(next)
    return { ...next, id }
  })
}
