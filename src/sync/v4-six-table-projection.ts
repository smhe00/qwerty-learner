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
import { isReviewSessionId } from '@/utils/db/review-session-identity'
import { stableWorkspaceJson } from './workspace-v4'
import { projectV4ForeignKeys } from './v4-foreign-key-projection'
import { inspectThreeWayReviewSessions } from './v4-session-three-way'
import type { ThreeWayReviewSessionPreview } from './v4-session-three-way'

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
  sessionId?: string
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
      /** Same UUID and identical content, still NOT authorized for restore. */
      matchedSessionPairs: number
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
  const seenUuids = new Set<string>()
  return source.reviewRecords.map(row => {
    if (!validId(row.id) || seenIds.has(row.id) ||
        typeof row.dict !== 'string' || !row.dict ||
        !validSeconds(row.createTime) ||
        !Array.isArray(row.words) ||
        !Number.isSafeInteger(row.index) || row.index < 0 ||
        (row.index > row.words.length &&
          !(row.isFinished === true && row.words.length === 0)) ||
        typeof row.isFinished !== 'boolean') {
      throw new Error('invalid-review-session')
    }
    if (row.sessionId !== undefined) {
      if (!isReviewSessionId(row.sessionId) || seenUuids.has(row.sessionId)) {
        throw new Error('invalid-review-session-id')
      }
      seenUuids.add(row.sessionId)
    }
    seenIds.add(row.id)
    return { origin, sourceId: row.id,
      ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
      dict: row.dict,
      createdAt: row.createTime, completed: row.isFinished,
      wordCount: row.words.length }
  })
}

/**
 * An equal immutable Session UUID with changed session contents is NOT a safe
 * duplicate: a cursor may have advanced independently on two devices.
 * Comparing timestamps, numeric IDs or just the UUID is insufficient.
 * Keep both session rows and fail closed on divergent copies. Verified common
 * ancestry plus an explicit reconciliation protocol is needed to merge them.
 */
function inspectCrossDeviceSessionIdentity(
  local: readonly IReviewRecord[],
  remote: readonly IReviewRecord[],
): number {
  const bySessionId = new Map<string, string>()
  for (const row of local) {
    if (row.sessionId) {
      const { id: _localId, ...logicalRow } = row
      bySessionId.set(row.sessionId, stableWorkspaceJson(logicalRow))
    }
  }
  let matched = 0
  for (const row of remote) {
    if (!row.sessionId) continue
    const left = bySessionId.get(row.sessionId)
    if (left === undefined) continue
    const { id: _remoteId, ...logicalRow } = row
    if (left !== stableWorkspaceJson(logicalRow)) {
      throw new Error('divergent-review-session-identity')
    }
    matched++
  }
  return matched
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
function projectV4SixTableEvidenceCore(input: {
  local: V4SixTableSource
  remote: V4SixTableSource
}, allowThreeWaySessionCandidate: boolean): SixTableConvergencePreview {
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
    // This exception is ONLY reached by the async wrapper after a pinned
    // ancestor three-way check. It never enables writing or publishing.
    const matchedSessionPairs = allowThreeWaySessionCandidate ? 0 :
      inspectCrossDeviceSessionIdentity(
        input.local.reviewRecords, input.remote.reviewRecords,
      )
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
        matchedSessionPairs,
      },
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'invalid-review-tables')
  }
}

/** Default two-way audit remains strictly fail-closed on diverged session UUID. */
export function projectV4SixTableEvidence(input: {
  local: V4SixTableSource
  remote: V4SixTableSource
}): SixTableConvergencePreview {
  return projectV4SixTableEvidenceCore(input, false)
}

export type ThreeWaySixTableCandidate =
  | { status: 'blocked'; publishReady: false; convergenceComplete: false;
      reason: string }
  | (Extract<SixTableConvergencePreview, { status: 'projected' }> & {
      sessionThreeWay: Extract<ThreeWayReviewSessionPreview, { status: 'projected' }>
    })

/**
 * A validated session three-way plan can accompany the six-table *preview*.
 * Neither the digest nor this combinator authenticate the original ancestor.
 * A caller must independently validate S1 owner, pinned V4 source, complete
 * event heads, and an undo journal before any future write-capable API exists.
 *
 * The default two-way function is NOT relaxed. Session candidates are returned
 * separately and never substituted into active device cursors.
 */
export async function inspectV4ThreeWaySixTableCandidate(input: {
  local: V4SixTableSource
  remote: V4SixTableSource
  ancestorSessions: readonly IReviewRecord[]
  pinnedAncestorDigest: string
}): Promise<ThreeWaySixTableCandidate> {
  const sessions = await inspectThreeWayReviewSessions({
    ancestor: input.ancestorSessions,
    pinnedAncestorDigest: input.pinnedAncestorDigest,
    local: input.local.reviewRecords,
    remote: input.remote.reviewRecords,
  })
  if (sessions.status !== 'projected') {
    return fail('three-way-session:' + sessions.reason)
  }
  const evidence = projectV4SixTableEvidenceCore(input, true)
  if (evidence.status !== 'projected') return evidence
  return { ...evidence, sessionThreeWay: sessions }
}
