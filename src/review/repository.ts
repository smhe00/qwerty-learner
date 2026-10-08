import {
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
  shouldDropLegacyTypingSeededState,
  shouldDropPrematureAcquisitionState,
} from './rebuild'
import { didEnterLongTermMastery } from '@/learn/mastery'
import {
  createInitialFsrsReviewWordState,
  rebuildActiveFsrsStateFromWordRecords,
} from './fsrs/active'
import {
  decideLearningLifecycleTransition,
  getLearningLifecycle,
  isActiveLearningState,
  pruneLearnSessionWord,
} from '@/learn/lifecycle'
import { CURRENT_REVIEW_STATE_VERSION, createInitialReviewWordState } from './types'
import type { IReviewWordState, ReviewOutcome } from './types'
import { db } from '@/utils/db/core'

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
  const result = await db.transaction(
    'rw',
    db.wordRecords,
    db.reviewWordStates,
    async () => {
      const existing = await getReviewWordState(dict, word)

      if (existing && getLearningLifecycle(existing) === 'excluded') {
        return {
          state: existing,
          basicComparator: undefined,
          applied: false,
          enteredLongTermMastery: false,
        }
      }

      const durableRecords = await db.wordRecords
        .where('word')
        .equals(word)
        .and((record) => record.dict === dict)
        .toArray()

      const sourceRecord =
        currentWordRecordId !== undefined
          ? durableRecords.find(
              (record) => record.id === currentWordRecordId,
            )
          : undefined

      if (
        sourceRecord?.reviewRatingDecision?.eligible === true &&
        sourceRecord.reviewRatingDecision.rating !== outcome
      ) {
        throw new Error(
          'persisted Review rating does not match scheduler outcome',
        )
      }

      const replayRecords =
        currentWordRecordId === undefined
          ? [
              ...durableRecords,
              {
                word,
                dict,
                chapter: -1,
                timeStamp: now,
                timing: [],
                wrongCount: outcome === 'again' ? 1 : 0,
                mistakes: {},
                sourceMode: 'learn' as const,
                learnItemKind: 'review' as const,
                reviewRatingDecision: {
                  eligible: true as const,
                  rating: outcome,
                  confidence: 1,
                  reasonCodes: ['legacy-direct-scheduler-call'],
                },
              },
            ]
          : durableRecords

      let next = rebuildActiveFsrsStateFromWordRecords(
        dict,
        word,
        replayRecords,
        { legacyDueAt: now },
      )

      if (!next) {
        throw new Error(
          'FSRS-6 active scheduler could not rebuild a state from Review history',
        )
      }

      if (existing) {
        next = {
          ...next,
          id: existing.id,
          lifecycle: existing.lifecycle ?? next.lifecycle,
          ...(existing.exclusion
            ? { exclusion: existing.exclusion }
            : {}),
        }
      }

      const basicComparator = rebuildBasicStateFromWordRecords(
        dict,
        word,
        replayRecords,
        { legacyDueAt: now },
      )

      const id = await db.reviewWordStates.put({
        ...next,
        id: existing?.id ?? next.id,
      })
      const persisted = { ...next, id }

      return {
        state: persisted,
        basicComparator:
          basicComparator?.schedulerState.kind === 'basic-v2'
            ? basicComparator
            : undefined,
        applied: true,
        enteredLongTermMastery: didEnterLongTermMastery(
          existing,
          persisted,
        ),
      }
    },
  )

  if (
    result.applied &&
    currentWordRecordId !== undefined &&
    currentWordRecordId > 0 &&
    result.basicComparator
  ) {
    try {
      const { persistFsrsLiveShadowObservation } = await import(
        './fsrs/live-shadow'
      )
      await persistFsrsLiveShadowObservation({
        dict,
        word,
        sourceRecordId: currentWordRecordId,
        basicState: result.basicComparator,
      })
    } catch (error) {
      console.error('failed to persist FSRS observation', error)
    }
  }

  if (
    result.applied &&
    result.enteredLongTermMastery &&
    currentWordRecordId !== undefined &&
    currentWordRecordId > 0
  ) {
    void import('@/achievement/engine')
      .then(({ processLiveLongTermMasteryCrossing }) =>
        processLiveLongTermMasteryCrossing({
          sourceRecordId: currentWordRecordId,
          dict,
          word,
          occurredAt: now,
        }),
      )
      .catch((error) => {
        console.error(
          'failed to process long-term mastery achievement event',
          error,
        )
      })
  }

  return result.state
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

    // FSRS activation uses a clean-state cutover. Pre-FSRS scheduler state is
    // disposable test data and is deliberately not migrated or bridged.
    if (hasStaleState) {
      await db.reviewWordStates.where('dict').equals(dict).delete()
    }

    const recordsByWord = new Map<string, typeof records>()
    for (const record of records) {
      const group = recordsByWord.get(record.word)
      if (group) group.push(record)
      else recordsByWord.set(record.word, [record])
    }

    let changedCount = hasStaleState ? existingStates.length : 0
    const retainedStates: IReviewWordState[] = []

    if (!hasStaleState) {
      for (const state of existingStates) {
        const wordRecords = recordsByWord.get(state.word) ?? []
        if (
          shouldDropPrematureAcquisitionState(state, wordRecords) ||
          shouldDropLegacyTypingSeededState(state, wordRecords)
        ) {
          await db.reviewWordStates
            .where('[dict+word]')
            .equals([dict, state.word])
            .delete()
          changedCount += 1
          continue
        }
        retainedStates.push(state)
      }
    }

    const existingByWord = new Map(
      retainedStates.map((state) => [state.word, state]),
    )

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

      const state = rebuildActiveFsrsStateFromWordRecords(
        dict,
        word,
        wordRecords,
        { legacyDueAt },
      )
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
      let state = rebuildActiveFsrsStateFromWordRecords(
        dict,
        word,
        wordRecords,
        { legacyDueAt },
      )
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
      ...createInitialFsrsReviewWordState(dict, word, now),
      lifecycle: 'active' as const,
      nextReviewAt: now + 86_400,
      updatedAt: now,
    }

    const id = await db.reviewWordStates.put(next)
    return { ...next, id }
  })
}
