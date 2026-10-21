/**
 * M2.4 read-only six-table convergence audit.
 *
 * THIS IS NOT a restorable V4 backup or permission to publish. Word attempts,
 * chapter/achievement foreign keys and FSRS state can be independently
 * projected, but completed/active Review sessions still have only origin-local
 * numeric identities. Preserve both sources as tagged evidence; never silently
 * dedupe sessions by timestamp or apply their cursors across devices.
 */
import type { AchievementEventRecord, AchievementStateRecord } from '@/achievement/types'
import type { IReviewWordState } from '@/review/types'
import type { IChapterRecord, IReviewRecord, IWordRecord } from '@/utils/db/record'
import { projectUuidLearningConvergence } from './v4-event-convergence'
import { projectV4ForeignKeys } from './v4-foreign-key-projection'

export type V4SixTableSource = {
  words: readonly IWordRecord[]
  chapters: readonly (IChapterRecord & { id?: number })[]
  reviewRecords: readonly IReviewRecord[]
  reviewWordStates: readonly IReviewWordState[]
  events: readonly AchievementEventRecord[]
  states: readonly AchievementStateRecord[]
}

type SessionEvidence = {
  origin: 'local' | 'remote'
  sourceId: number
  dict: string
  createdAt: number
  completed: boolean
  wordCount: number
}

export type SixTableConvergencePreview =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false }
  | {
    status: 'projected'
    publishReady: false
    convergenceComplete: false
    wordRecords: IWordRecord[]
    chapterRecords: (IChapterRecord & { id: number })[]
    /** IndexedDB reviewRecords are NOT merged: these are audit evidence only. */
    sessionEvidence: SessionEvidence[]
    /** Recomputed from immutable attempt evidence, never copied from either device. */
    reviewWordStates: IReviewWordState[]
    achievementEvents: AchievementEventRecord[]
    achievementStates: AchievementStateRecord[]
    stats: {
      uniqueAttempts: number
      projectedReviewStates: number
      sessionRowsNeedingAncestry: number
      activeSessionRows: number
    }
  }

const fail = (reason: string): SixTableConvergencePreview =>
  ({ status: 'blocked', reason, publishReady: false, convergenceComplete: false })

const validId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0
const validSeconds = (time: unknown): time is number =>
  typeof time === 'number' && Number.isSafeInteger(time) &&
  time >= 0 && time <= 86_400_000_000
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const wordKey = (dict: string, word: string): string =>
  JSON.stringify([dict, word])

function inspectSessions(
  source: V4SixTableSource,
  origin: SessionEvidence['origin'],
): SessionEvidence[] {
  const seenIds = new Set<number>()
  return source.reviewRecords.map(row => {
    if (!validId(row.id) || seenIds.has(row.id) ||
        typeof row.dict !== 'string' || !row.dict ||
        !validSeconds(row.createTime) ||
        !Array.isArray(row.words) ||
        !Number.isSafeInteger(row.index) || row.index < 0 ||
        row.index > row.words.length ||
        typeof row.isFinished !== 'boolean') {
      throw new Error('invalid-review-session')
    }
    seenIds.add(row.id)
    return { origin, sourceId: row.id, dict: row.dict,
      createdAt: row.createTime, completed: row.isFinished,
      wordCount: row.words.length }
  })
}

/**
 * Validate persisted scheduler state before replay. Manual exclusion, missing
 * attempts and historic scheduler-only updates have no immutable merge
 * identity yet. Never turn those into an "active" replayed state silently.
 */
function inspectStates(
  source: V4SixTableSource,
  replay: ReadonlyMap<string, IReviewWordState>,
): void {
  const seenKeys = new Set<string>()
  const ids = new Set<number>()
  for (const state of source.reviewWordStates) {
    const key = wordKey(state.dict, state.word)
    if (!validId(state.id) || ids.has(state.id) ||
        typeof state.dict !== 'string' || !state.dict ||
        typeof state.word !== 'string' || !state.word ||
        seenKeys.has(key) ||
        !Number.isSafeInteger(state.reviewCount) || state.reviewCount < 0 ||
        !validSeconds(state.createdAt) || !validSeconds(state.updatedAt) ||
        !validSeconds(state.nextReviewAt) ||
        (state.lastReviewedAt !== undefined &&
          !validSeconds(state.lastReviewedAt))) {
      throw new Error('invalid-review-word-state')
    }
    ids.add(state.id)
    seenKeys.add(key)
    if (state.lifecycle === 'excluded' || state.exclusion !== undefined) {
      throw new Error('unreplayed-learning-exclusion')
    }
    if (state.lifecycle !== undefined && state.lifecycle !== 'active') {
      throw new Error('invalid-learning-lifecycle')
    }
    if (state.schedulerState?.kind !== 'fsrs6' ||
        !Number.isFinite(state.schedulerState.difficulty) ||
        !Number.isFinite(state.schedulerState.stability)) {
      throw new Error('unverified-legacy-scheduler')
    }
    const projected = replay.get(key)
    if (!projected || projected.reviewCount < state.reviewCount) {
      throw new Error('missing-scheduler-source-evidence')
    }
  }
}

/** No IDB, network, V4 vault, settings or sessions are modified. */
export function projectV4SixTableEvidence(input: {
  local: V4SixTableSource
  remote: V4SixTableSource
}): SixTableConvergencePreview {
  const references = projectV4ForeignKeys(input)
  if (references.status === 'blocked') return fail('foreign-keys:' + references.reason)
  const replay = projectUuidLearningConvergence({
    local: input.local.words, remote: input.remote.words,
  })
  if (replay.status === 'blocked') return fail('fsrs:' + replay.reason)
  try {
    const sessions = [
      ...inspectSessions(input.local, 'local'),
      ...inspectSessions(input.remote, 'remote'),
    ].sort((a, b) => a.createdAt - b.createdAt ||
      cmp(a.origin, b.origin) || a.sourceId - b.sourceId)
    const replayByWord = new Map<string, IReviewWordState>()
    for (const word of replay.words) {
      if (word.fsrsState) {
        replayByWord.set(wordKey(word.dict, word.word), word.fsrsState)
      }
    }
    inspectStates(input.local, replayByWord)
    inspectStates(input.remote, replayByWord)
    const rebuilt = [...replayByWord.values()]
      .sort((a, b) => cmp(a.dict, b.dict) || cmp(a.word, b.word))
      .map((row, index) => ({ ...row, id: index + 1 }))
    return {
      status: 'projected', publishReady: false, convergenceComplete: false,
      wordRecords: references.words,
      chapterRecords: references.chapters,
      sessionEvidence: sessions,
      reviewWordStates: rebuilt,
      achievementEvents: references.events,
      achievementStates: references.states,
      stats: {
        uniqueAttempts: references.words.length,
        projectedReviewStates: rebuilt.length,
        sessionRowsNeedingAncestry: sessions.length,
        activeSessionRows: sessions.filter(row => !row.completed).length,
      },
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'invalid-review-tables')
  }
}
