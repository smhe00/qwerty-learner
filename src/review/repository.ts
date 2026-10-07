import {
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
  shouldDropLegacyTypingSeededState,
  shouldDropPrematureAcquisitionState,
} from './rebuild'
import { didEnterLongTermMastery } from '@/learn/mastery'
import {
  createInitialFsrsReviewWordState,
  isCurrentActiveFsrsState,
  rebuildActiveFsrsStateFromWordRecords,
} from './fsrs/active'
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
        {
          legacyDueAt: now,
          priorState: existing,
        },
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

      const basicComparator =
        existing &&
        (
          existing.schedulerState.kind === 'basic-v1' ||
          existing.schedulerState.kind === 'basic-v2'
        )
          ? scheduleBasicReview({
              state: existing,
              outcome,
              now,
            })
          : rebuildBasicStateFromWordRecords(
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

    const recordsByWord = new Map<string, typeof records>()
    for (const record of records) {
      const group = recordsByWord.get(record.word)
      if (group) group.push(record)
      else recordsByWord.set(record.word, [record])
    }

    let changedCount = 0
    const retainedWords = new Set<string>()

    for (const previous of existingStates) {
      const wordRecords = recordsByWord.get(previous.word) ?? []

      if (
        shouldDropPrematureAcquisitionState(previous, wordRecords) ||
        shouldDropLegacyTypingSeededState(previous, wordRecords)
      ) {
        if (previous.id !== undefined) {
          await db.reviewWordStates.delete(previous.id)
        } else {
          await db.reviewWordStates
            .where('[dict+word]')
            .equals([dict, previous.word])
            .delete()
        }
        changedCount += 1
        continue
      }

      const needsFsrsMigration =
        previous.stateVersion !== CURRENT_REVIEW_STATE_VERSION ||
        (
          previous.schedulerState.kind === 'fsrs6' &&
          !isCurrentActiveFsrsState(previous)
        )

      let next = previous

      if (needsFsrsMigration) {
        const replayed = rebuildActiveFsrsStateFromWordRecords(
          dict,
          previous.word,
          wordRecords,
          { legacyDueAt },
        )

        // A replay is complete enough to replace the durable legacy state
        // only when it accounts for at least the number of reviews already
        // represented by that state. Otherwise keep the legacy scheduler row
        // as an explicit bridge: due/lifecycle/counters remain authoritative
        // until the next eligible Review can hand control to FSRS r0.84.
        if (
          replayed &&
          replayed.reviewCount >= previous.reviewCount
        ) {
          next = {
            ...replayed,
            id: previous.id,
            lifecycle: previous.lifecycle ?? replayed.lifecycle,
            ...(previous.exclusion
              ? { exclusion: previous.exclusion }
              : {}),
          }
        } else {
          next = {
            ...previous,
            stateVersion: CURRENT_REVIEW_STATE_VERSION,
          }
        }
      }

      next = reactivateReviewStateFromLearningEvidence(
        next,
        wordRecords,
        legacyDueAt,
      )

      if (next !== previous || needsFsrsMigration) {
        await db.reviewWordStates.put({
          ...next,
          id: previous.id,
        })
        changedCount += 1
      }

      retainedWords.add(previous.word)
    }

    for (const [word, wordRecords] of recordsByWord) {
      if (retainedWords.has(word)) continue

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
      if (group) group.push(record)
      else recordsByWord.set(record.word, [record])
    }

    const nextStates: IReviewWordState[] = []
    const allWords = new Set([
      ...previousByWord.keys(),
      ...recordsByWord.keys(),
    ])

    for (const word of allWords) {
      const previous = previousByWord.get(word)
      const wordRecords = recordsByWord.get(word) ?? []

      if (
        previous &&
        (
          shouldDropPrematureAcquisitionState(previous, wordRecords) ||
          shouldDropLegacyTypingSeededState(previous, wordRecords)
        )
      ) {
        continue
      }

      const replayed = rebuildActiveFsrsStateFromWordRecords(
        dict,
        word,
        wordRecords,
        { legacyDueAt },
      )

      let next: IReviewWordState | undefined
      if (
        previous &&
        (
          !replayed ||
          replayed.reviewCount < previous.reviewCount
        )
      ) {
        next = {
          ...previous,
          stateVersion: CURRENT_REVIEW_STATE_VERSION,
        }
      } else {
        next = replayed
      }

      if (!next) continue

      if (previous) {
        next = {
          ...next,
          id: previous.id,
          lifecycle: previous.lifecycle ?? next.lifecycle,
          ...(previous.exclusion
            ? { exclusion: previous.exclusion }
            : {}),
        }
      }

      next = reactivateReviewStateFromLearningEvidence(
        next,
        wordRecords,
        legacyDueAt,
      )
      nextStates.push(next)
    }

    await db.reviewWordStates.where('dict').equals(dict).delete()
    for (const state of nextStates) {
      await db.reviewWordStates.put(state)
    }

    return nextStates.length
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
