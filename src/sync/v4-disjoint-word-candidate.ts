/**
 * M2.13: disjoint-word, COMPLETE Backup V4 candidate (read-only).
 *
 * A word-level independent edit is not a workspace-wide conflict. This
 * narrow admission permits two clients to append attempts, including for
 * the SAME word, with origin-local colliding Dexie primary keys. Every
 * independently identified attempt is kept and chronologically replayed.
 *
 * Strict constraints: externally authenticated common ancestor; base rows
 * immutable; no changes to chapter, review-session, achievement tables or
 * daily sessions; no legacy NEW attempt; no unproven scheduler-only update.
 * For overlapping words, all history must have UUID, be replayable and
 * agree with each device's persisted review-count evidence.
 * Four untouched tables are kept EXACTLY.
 *
 * Without replay verified against the actual device event heads and
 * journaled M4 admission, this is a candidate, never permission to publish.
 */
import { rebuildActiveFsrsStateFromWordRecords } from '@/review/fsrs/active'
import type { IReviewWordState } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'
import { projectUuidLearningConvergence } from './v4-event-convergence'
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import { previewConservativeThreeWayV4 } from './v4-conservative-three-way'
import { inspectPinnedV4FastForward } from './v4-fast-forward-preview'
import {
  assertRestorableWorkspaceV4,
  stableWorkspaceJson,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

type Row = Record<string, unknown>
type Collection = { tableName: string; rows: Row[] }
type Database = { data: { data: Collection[]; tables: unknown[] } }
type Source = 'local' | 'remote'
const PROTECTED = ['chapterRecords', 'reviewRecords',
  'achievementEvents', 'achievementStates'] as const
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const key = (dict: string, word: string) => JSON.stringify([dict, word])
const json = (value: unknown) => stableWorkspaceJson(value)

export type DisjointWordV4Candidate =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false }
  | { status: 'projected';
      reason: 'disjoint-word-full-v4-preview-only';
      publishReady: false; convergenceComplete: false;
      candidate: WorkspaceSnapshotV4
      candidateFingerprint: string
      localNewAttempts: number
      remoteNewAttempts: number
      updatedWordStates: number
      chronologicallyReplayedWords: number
      requiresFullFsrsAndCloudAdmission: true }

function blocked(reason: string): DisjointWordV4Candidate {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false }
}
function dataOf(s: WorkspaceSnapshotV4): Database {
  return s.workspaceData.database as Database
}
function table(s: WorkspaceSnapshotV4, name: string): Collection {
  const found = dataOf(s).data.data.find(t => t.tableName === name)
  if (!found || !Array.isArray(found.rows)) {
    throw new Error('disjoint-missing-table:' + name)
  }
  return found
}
function validId(id: unknown): id is number {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
}
function wordKey(r: Row): string {
  if (typeof r.dict !== 'string' || !r.dict ||
      typeof r.word !== 'string' || !r.word) {
    throw new Error('disjoint-invalid-word')
  }
  return key(r.dict, r.word)
}
function indexById(rows: Row[]): Map<number, Row> {
  const indexed = new Map<number, Row>()
  for (const row of rows) {
    if (!validId(row.id) || indexed.has(row.id)) {
      throw new Error('disjoint-duplicate-or-invalid-primary-key')
    }
    indexed.set(row.id, row)
  }
  return indexed
}
function verifyImmutableAncestorRows(
  ancestor: Row[], candidate: Row[], origin: Source,
): Row[] {
  const baseline = indexById(ancestor)
  const next = indexById(candidate)
  for (const [id, row] of baseline) {
    if (!next.has(id) || json(row) !== json(next.get(id))) {
      throw new Error('disjoint-' + origin + '-ancestor-record-rewritten')
    }
  }
  return candidate.filter(row => !baseline.has(row.id as number))
}
function cloneWithNewId(row: Row, id: number): Row {
  const result = structuredClone(row)
  const oldId = result.id
  result.id = id
  if (result.fsrsShadow !== undefined) {
    const shadow = result.fsrsShadow as { sourceRecordId?: number }
    if (!shadow || typeof shadow !== 'object' ||
        (shadow.sourceRecordId !== undefined &&
         shadow.sourceRecordId !== oldId)) {
      throw new Error('disjoint-fsrs-shadow-source-mismatch')
    }
    result.fsrsShadow = { ...shadow, sourceRecordId: id }
  }
  return result
}
function stateKey(row: Row): string { return wordKey(row) }
function stateByKey(rows: Row[]): Map<string, Row> {
  indexById(rows)
  const out = new Map<string, Row>()
  for (const row of rows) {
    const k = stateKey(row)
    if (out.has(k)) throw new Error('disjoint-duplicate-review-state')
    out.set(k, row)
  }
  return out
}
function withoutId(value: Row | undefined): string {
  if (!value) return 'absent'
  const { id: _id, ...rest } = value
  return json(rest)
}
function isStateChange(base: Row | undefined, changed: Row | undefined): boolean {
  return withoutId(base) !== withoutId(changed)
}
/** Derived, origin-local scheduler hints do not identify the original study. */
function immutableAttempt(row: Row): string {
  const { id: _id, fsrsShadow: _fsrsShadow,
    reviewPolicyShadow: _policyShadow, ...evidence } = row
  return json(evidence)
}
function validateSchedulerRow(row: Row, word: string): void {
  const state = row as unknown as IReviewWordState
  if (state.schedulerState?.kind !== 'fsrs6' ||
      state.lifecycle === 'excluded' || state.exclusion ||
      !Number.isSafeInteger(state.reviewCount) || state.reviewCount < 0 ||
      !Number.isFinite(state.schedulerState.difficulty) ||
      !Number.isFinite(state.schedulerState.stability) ||
      state.word !== word) {
    throw new Error('disjoint-unverified-fsrs-state')
  }
}

/** Complete V4 preview; unchanged four tables retain their original IDs. */
export async function previewDisjointWordV4(input: {
  accountId: string
  pinnedAncestorFingerprint: string
  ancestor: WorkspaceSnapshotV4
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
}): Promise<DisjointWordV4Candidate> {
  try {
    const proof = await inspectPinnedV4FastForward(input)
    if (proof.status === 'blocked' &&
        proof.reason !== 'both-devices-changed-requires-six-table-merge') {
      return blocked(proof.reason)
    }
    const { ancestor, local, remote } = input
    for (const name of PROTECTED) {
      const original = json(table(ancestor, name))
      if (json(table(local, name)) !== original ||
          json(table(remote, name)) !== original) {
        return blocked('disjoint-protected-table-changed:' + name)
      }
    }
    const sessions = json(ancestor.workspaceData.learnRuntime)
    if (json(local.workspaceData.learnRuntime) !== sessions ||
        json(remote.workspaceData.learnRuntime) !== sessions) {
      return blocked('disjoint-daily-session-changed')
    }
    const baseWords = table(ancestor, 'wordRecords').rows
    const baseIds = indexById(baseWords)
    const additions: Record<Source, Row[]> = {
      local: verifyImmutableAncestorRows(
        baseWords, table(local, 'wordRecords').rows, 'local'),
      remote: verifyImmutableAncestorRows(
        baseWords, table(remote, 'wordRecords').rows, 'remote'),
    }
    const touched: Record<Source, Set<string>> = {
      local: new Set<string>(), remote: new Set<string>(),
    }
    const attempts = new Map<string, string>()
    const originalIds = new Set<string>()
    for (const row of baseWords) {
      wordKey(row)
      if (row.attemptId !== undefined) {
        if (!isLearningAttemptId(row.attemptId) ||
            attempts.has(row.attemptId)) {
          return blocked('disjoint-invalid-ancestor-attempt-id')
        }
        attempts.set(row.attemptId, immutableAttempt(row))
        originalIds.add(row.attemptId)
      }
    }
    for (const origin of ['local', 'remote'] as const) {
      for (const row of additions[origin]) {
        const k = wordKey(row)
        if (!isLearningAttemptId(row.attemptId) ||
            !Number.isSafeInteger(row.timeStamp) ||
            (row.timeStamp as number) < 0) {
          return blocked('disjoint-unverified-new-attempt')
        }
        if (originalIds.has(row.attemptId)) {
          return blocked('disjoint-ancestor-uuid-reused')
        }
        const evidence = immutableAttempt(row)
        if (attempts.has(row.attemptId) &&
            attempts.get(row.attemptId) !== evidence) {
          return blocked('disjoint-contradictory-attempt')
        }
        attempts.set(row.attemptId, evidence)
        touched[origin].add(k)
      }
    }
    const baseStates = stateByKey(table(ancestor, 'reviewWordStates').rows)
    const chosenStates = new Map(baseStates)
    const updates: Record<Source, Map<string, Row>> = {
      local: new Map<string, Row>(), remote: new Map<string, Row>(),
    }
    for (const origin of ['local', 'remote'] as const) {
      const next = stateByKey(table(input[origin], 'reviewWordStates').rows)
      const combined = new Set([...baseStates.keys(), ...next.keys()])
      for (const k of combined) {
        const before = baseStates.get(k)
        const after = next.get(k)
        if (before && !after) return blocked('disjoint-deleted-scheduler-state')
        if (!isStateChange(before, after)) continue
        if (!after) return blocked('disjoint-deleted-scheduler-state')
        const word = JSON.parse(k)[1] as string
        validateSchedulerRow(after, word)
        if (!touched[origin].has(k)) {
          return blocked('disjoint-scheduler-state-without-new-attempt')
        }
        if (before && (after.reviewCount as number) <
            (before.reviewCount as number)) {
          return blocked('disjoint-scheduler-review-count-regressed')
        }
        touched[origin].add(k)
        updates[origin].set(k, after)
      }
    }
    const overlapping = [...touched.local].filter(k => touched.remote.has(k))
    // Never treat two distinct UUIDs as a duplicate merely because they
    // review the same word within a minute or share an old FSRS base digest.
    for (const k of overlapping) {
      const localRows = table(local, 'wordRecords').rows.filter(r => wordKey(r) === k)
      const remoteRows = table(remote, 'wordRecords').rows.filter(r => wordKey(r) === k)
      const replay = projectUuidLearningConvergence({
        local: localRows as IWordRecord[],
        remote: remoteRows as IWordRecord[],
      })
      if (replay.status !== 'projected' || replay.words.length !== 1) {
        return blocked('disjoint-overlap-unreplayable:' + replay.reason)
      }
    }
    // Existing conservative three-way logic handles UI settings and
    // navigation. Remove ONLY the already audited learning differences
    // from temporary, detached copies, never from the original snapshots.
    const mockLocal = structuredClone(local)
    const mockRemote = structuredClone(remote)
    for (const mock of [mockLocal, mockRemote]) {
      mock.workspaceData.database = structuredClone(ancestor.workspaceData.database)
      mock.workspaceData.learnRuntime = structuredClone(ancestor.workspaceData.learnRuntime)
    }
    const control = await previewConservativeThreeWayV4({
      ...input, local: mockLocal, remote: mockRemote,
    })
    if (control.status !== 'projected') {
      return blocked('disjoint-controls:' + control.reason)
    }
    const candidate = control.candidate
    // Keep ancestor IDs stable: existing chapter/achievement references
    // remain valid. New origin-local numeric IDs are never blindly copied.
    let maxWordId = Math.max(0, ...baseIds.keys())
    const mergedWords = structuredClone(baseWords)
    const mergedAttemptIds = new Set(baseWords.map(r => r.attemptId)
      .filter((id): id is string => typeof id === 'string'))
    for (const row of [...additions.local, ...additions.remote]
      .sort((a, b) => (a.timeStamp as number) - (b.timeStamp as number) ||
        compare(String(a.attemptId), String(b.attemptId)))) {
      if (mergedAttemptIds.has(row.attemptId as string)) continue
      mergedWords.push(cloneWithNewId(row, ++maxWordId))
      mergedAttemptIds.add(row.attemptId as string)
    }
    for (const source of ['local', 'remote'] as const) {
      for (const [k, state] of updates[source]) {
        if (!overlapping.includes(k)) chosenStates.set(k, state)
      }
    }
    for (const k of overlapping) {
      const mergedHistory = mergedWords.filter(r => wordKey(r) === k)
      const [dict, word] = JSON.parse(k) as [string, string]
      const hasReview = mergedHistory.some(r =>
        r.chapter === -1 && r.reviewRatingDecision &&
        (r.reviewRatingDecision as { eligible?: boolean }).eligible === true)
      // A complete, pinned history can be replayed, but missing or legacy
      // evidence must not manufacture a new durable FSRS state.
      const sorted = [...mergedHistory].sort((a,b) =>
        (a.timeStamp as number) - (b.timeStamp as number) ||
        compare(String(a.attemptId), String(b.attemptId)))
      const replayed = rebuildActiveFsrsStateFromWordRecords(
        dict, word, sorted as IWordRecord[])
      if (hasReview && (!replayed || replayed.reviewCount === 0)) {
        return blocked('disjoint-overlap-missing-fsrs-history')
      }
      const before = baseStates.get(k)
      if (before && (before.lifecycle === 'excluded' || before.exclusion)) {
        return blocked('disjoint-overlap-excluded-state')
      }
      for (const source of ['local','remote'] as const) {
        const sourceRows = table(input[source], 'wordRecords').rows
          .filter(r => wordKey(r) === k)
        const originReplay = rebuildActiveFsrsStateFromWordRecords(
          dict, word, sourceRows as IWordRecord[])
        const stored = stateByKey(table(input[source], 'reviewWordStates').rows).get(k)
        if (stored && (
          !originReplay ||
          stored.reviewCount !== originReplay.reviewCount ||
          (stored.lastOutcome !== undefined &&
            stored.lastOutcome !== originReplay.lastOutcome))) {
          return blocked('disjoint-overlap-unverified-device-fsrs:' + source)
        }
      }
      if (replayed) chosenStates.set(k, replayed as unknown as Row)
    }
    const stateRows = [...chosenStates.entries()].sort(([a], [b]) =>
      compare(a, b))
    const seenStateIds = new Set<number>()
    const priorStateIds = new Map([...baseStates].map(([k, r]) => [
      k, r.id as number,
    ]))
    let nextStateId = Math.max(0, ...priorStateIds.values())
    const normalizedStates: Row[] = []
    for (const [k, row] of stateRows) {
      const oldId = priorStateIds.get(k)
      const id = oldId ?? ++nextStateId
      if (seenStateIds.has(id)) throw new Error('disjoint-state-id-collision')
      seenStateIds.add(id)
      normalizedStates.push({ ...structuredClone(row), id })
    }
    table(candidate, 'wordRecords').rows = mergedWords
    table(candidate, 'reviewWordStates').rows = normalizedStates
    assertRestorableWorkspaceV4(candidate)
    return {
      status: 'projected', reason: 'disjoint-word-full-v4-preview-only',
      publishReady: false, convergenceComplete: false,
      candidate, candidateFingerprint: await workspaceFingerprintV4(candidate),
      localNewAttempts: additions.local.length,
      remoteNewAttempts: additions.remote.length,
      updatedWordStates: updates.local.size + updates.remote.size,
      chronologicallyReplayedWords: overlapping.length,
      requiresFullFsrsAndCloudAdmission: true,
    }
  } catch (error) {
    return blocked('disjoint-v4-invalid:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
