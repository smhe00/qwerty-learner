/**
 * M4.1 monotonic local adoption of a SERVER-WITNESSED immutable M3 prefix.
 *
 * This pure builder is deliberately not a cloud-convergence certificate:
 * eventually-consistent receipt enumeration cannot prove an entire account's
 * device set. It is safe to adopt only the explicitly verified subset because
 * the candidate preserves all local V4 evidence, including every unrelated
 * durable table, Learn session and user preference, exactly as captured.
 *
 * A caller MUST validate each server batch/chain/account independently, own
 * the S1 exclusive pre-mount writer lease and stage a durable M4 undo journal
 * before restoring these bytes. No event/blob listing alone authorizes writes.
 */
import type { IWordRecord } from '@/utils/db/record'
import type { IReviewWordState } from '@/review/types'
import { immutableAttempt } from './multi-device-outbox'
import { projectUuidLearningConvergence } from './v4-event-convergence'
import {
  assertRestorableWorkspaceV4, stableWorkspaceJson, workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

type Row = Record<string, unknown>
type Table = { tableName: string; rows: Row[] }
type Database = { data: { data: Table[]; tables: { name: string; rowCount?: number }[] } }

export type MonotonicM4Candidate =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false }
  | { status: 'unchanged'; reason: 'all-witnessed-attempts-already-local';
      publishReady: false; convergenceComplete: false }
  | { status: 'candidate'; candidate: WorkspaceSnapshotV4;
      candidateFingerprint: string; newlyAdoptedAttempts: number;
      witnessedAttempts: number; publishReady: false;
      convergenceComplete: false }

const fail = (reason: string): MonotonicM4Candidate => ({
  status: 'blocked', reason, publishReady: false, convergenceComplete: false,
})
const wordKey = (dict: string, word: string) => JSON.stringify([dict, word])
function table(snapshot: WorkspaceSnapshotV4, name: string): Row[] {
  const matching = ((snapshot.workspaceData.database as Database)
    .data.data).filter(item => item.tableName === name)
  if (matching.length !== 1 || !Array.isArray(matching[0].rows)) {
    throw new Error('m4-prefix-missing-table:' + name)
  }
  return matching[0].rows
}
function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}
/** A candidate alone is NEVER write permission; only the witnessed browser
 * adapter may supply authenticated batches and invoke an M4 journal. */
export async function previewMonotonicWitnessedM4(input: {
  accountId: string
  local: WorkspaceSnapshotV4
  /** Canonical, server-verified events from complete explicit chain prefixes. */
  witnessedEvents: readonly IWordRecord[]
}): Promise<MonotonicM4Candidate> {
  try {
    const { accountId, local, witnessedEvents } = input
    if (!accountId || local.metadata.source.kind !== 'account' ||
        local.metadata.source.accountId !== accountId ||
        !Array.isArray(witnessedEvents) || witnessedEvents.length > 4096) {
      return fail('m4-prefix-invalid-owner-or-budget')
    }
    assertRestorableWorkspaceV4(local)
    const originalWords = table(local, 'wordRecords')
    const wordsByUuid = new Map<string, string>()
    const existingIds = new Set<number>()
    let lastWordId = 0
    for (const raw of originalWords) {
      if (!validId(raw.id) || existingIds.has(raw.id)) {
        return fail('m4-prefix-invalid-local-primary-key')
      }
      existingIds.add(raw.id)
      lastWordId = Math.max(lastWordId, raw.id)
      // We cannot invent identity for legacy rows or silently collapse them.
      if (typeof raw.attemptId !== 'string') {
        return fail('m4-prefix-unanchored-legacy-attempt')
      }
      const canonical = immutableAttempt(raw as IWordRecord)
      if (wordsByUuid.has(canonical.attemptId!)) {
        return fail('m4-prefix-duplicate-local-attempt')
      }
      wordsByUuid.set(canonical.attemptId!,
        stableWorkspaceJson(canonical))
    }

    const incoming = new Map<string, IWordRecord>()
    for (const event of witnessedEvents) {
      const normalized = immutableAttempt(event)
      if (stableWorkspaceJson(event) !== stableWorkspaceJson(normalized)) {
        return fail('m4-prefix-remote-is-not-immutable-evidence')
      }
      const id = normalized.attemptId!
      const expected = stableWorkspaceJson(normalized)
      if (incoming.has(id) &&
          stableWorkspaceJson(incoming.get(id)) !== expected) {
        return fail('m4-prefix-conflicting-server-attempt')
      }
      const localEvidence = wordsByUuid.get(id)
      if (localEvidence && localEvidence !== expected) {
        return fail('m4-prefix-conflicting-local-attempt')
      }
      incoming.set(id, normalized)
    }
    const additions = [...incoming.values()].filter(event =>
      !wordsByUuid.has(event.attemptId!))
      .sort((a, b) => a.timeStamp - b.timeStamp ||
        (a.attemptId! < b.attemptId! ? -1 : a.attemptId! > b.attemptId! ? 1 : 0))
    if (!additions.length) {
      return { status: 'unchanged',
        reason: 'all-witnessed-attempts-already-local',
        publishReady: false, convergenceComplete: false }
    }
    if (!Number.isSafeInteger(lastWordId + additions.length)) {
      return fail('m4-prefix-primary-key-exhausted')
    }
    const projected = projectUuidLearningConvergence({
      local: originalWords as IWordRecord[],
      remote: [...incoming.values()],
    })
    if (projected.status !== 'projected') {
      return fail('m4-prefix-fsrs-projection:' + projected.reason)
    }

    const candidate = structuredClone(local)
    const candidateWords = table(candidate, 'wordRecords')
    const candidateStates = table(candidate, 'reviewWordStates')
    const stateByWord = new Map<string, Row>()
    const occupiedStates = new Set<number>()
    let nextStateId = 0
    for (const state of candidateStates) {
      if (!validId(state.id) || occupiedStates.has(state.id) ||
          typeof state.dict !== 'string' || typeof state.word !== 'string') {
        return fail('m4-prefix-invalid-local-review-state')
      }
      occupiedStates.add(state.id)
      nextStateId = Math.max(nextStateId, state.id)
      const key = wordKey(state.dict, state.word)
      if (stateByWord.has(key)) return fail('m4-prefix-duplicate-review-state')
      stateByWord.set(key, state)
    }
    const touched = new Set(additions.map(row => wordKey(row.dict, row.word)))
    for (const word of projected.words) {
      if (!touched.has(wordKey(word.dict, word.word))) continue
      const key = wordKey(word.dict, word.word)
      const existing = stateByWord.get(key)
      if (existing && (existing.lifecycle === 'excluded' ||
          existing.exclusion !== undefined)) {
        return fail('m4-prefix-manual-exclusion-needs-arbitration')
      }
      if (word.fsrsState === null) {
        if (existing) return fail('m4-prefix-existing-fsrs-unreplayable')
        continue
      }
      const replay = word.fsrsState as IReviewWordState
      if (replay.schedulerState.kind !== 'fsrs6') {
        return fail('m4-prefix-non-fsrs-replay')
      }
      const stateId = existing?.id ?? ++nextStateId
      if (!validId(stateId)) return fail('m4-prefix-state-id-exhausted')
      const row = { ...replay, id: stateId } as Row
      if (existing) {
        // Preserve any unknown schema extension rather than silently erase it.
        if (Object.keys(existing).some(k => !(k in row))) {
          return fail('m4-prefix-state-extension-needs-arbitration')
        }
        const index = candidateStates.findIndex(item => item.id === stateId)
        if (index < 0) return fail('m4-prefix-review-state-disappeared')
        candidateStates[index] = row
      } else {
        candidateStates.push(row)
      }
    }
    candidateWords.push(...additions.map((record, index) =>
      ({ ...structuredClone(record), id: lastWordId + index + 1 })))
    // Dexie exports an explicit rowCount in each table's manifest. Keeping
    // its OLD value after adding UUID rows causes the candidate V4 fingerprint
    // to disagree with a fresh post-import db.export() and abort M4 readback.
    // Only update the two mutated tables, retaining every other manifest byte.
    const manifest = (candidate.workspaceData.database as Database).data.tables
    for (const name of ['wordRecords', 'reviewWordStates']) {
      const entry = manifest.find(item => item.name === name)
      if (!entry) return fail('m4-prefix-missing-table-manifest:' + name)
      if (entry.rowCount !== undefined) {
        if (!Number.isSafeInteger(entry.rowCount) || entry.rowCount < 0) {
          return fail('m4-prefix-invalid-table-row-count:' + name)
        }
        entry.rowCount = table(candidate, name).length
      }
    }
    // All six durable tables are present. No other table, session, setting or
    // navigation object is changed; every original WordRecord remains exact.
    assertRestorableWorkspaceV4(candidate)
    for (const name of ['chapterRecords', 'reviewRecords',
      'achievementEvents', 'achievementStates']) {
      if (stableWorkspaceJson(table(local, name)) !==
          stableWorkspaceJson(table(candidate, name))) {
        return fail('m4-prefix-unrelated-table-mutated:' + name)
      }
    }
    if (stableWorkspaceJson(candidateWords.slice(0, originalWords.length)) !==
        stableWorkspaceJson(originalWords) ||
        stableWorkspaceJson(candidate.workspaceData.settings) !==
        stableWorkspaceJson(local.workspaceData.settings) ||
        stableWorkspaceJson(candidate.workspaceData.learnRuntime) !==
        stableWorkspaceJson(local.workspaceData.learnRuntime) ||
        stableWorkspaceJson(candidate.workspaceData.navigation) !==
        stableWorkspaceJson(local.workspaceData.navigation)) {
      return fail('m4-prefix-original-workspace-mutated')
    }
    if (candidateWords.length !== originalWords.length + additions.length ||
        additions.some(event => candidateWords.filter(row =>
          row.attemptId === event.attemptId).length !== 1)) {
      return fail('m4-prefix-witnessed-attempt-loss')
    }
    return {
      status: 'candidate', candidate,
      candidateFingerprint: await workspaceFingerprintV4(candidate),
      newlyAdoptedAttempts: additions.length, witnessedAttempts: incoming.size,
      publishReady: false, convergenceComplete: false,
    }
  } catch (error) {
    return fail('m4-prefix-candidate-invalid:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
