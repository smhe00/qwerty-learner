/**
 * Independent immutable-evidence conservation check for a V4 merge candidate.
 * Zero deletions and zero inventions of UUID events or ReviewSession IDs.
 * Numeric Dexie IDs and derived FSRS shadows are NOT learning identity.
 *
 * This is strictly a no-loss precondition, never M4/Cloud write authorization.
 */
import { stableWorkspaceJson } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

type Row = Record<string, unknown>
type Input = {
  ancestor: WorkspaceSnapshotV4
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
  candidate: WorkspaceSnapshotV4
}
export type V4LosslessEvidenceAudit =
  | { status: 'verified'; uniqueAttempts: number; sessionIds: number
      publishReady: false; convergenceComplete: false }
  | { status: 'blocked'; reason: string
      publishReady: false; convergenceComplete: false }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function rows(snapshot: WorkspaceSnapshotV4, table: string): Row[] {
  const database = snapshot.workspaceData.database as {
    data?: { data?: { tableName: string; rows: Row[] }[] }
  }
  const match = database?.data?.data?.filter(x => x.tableName === table)
  if (!match || match.length !== 1 || !Array.isArray(match[0].rows)) {
    throw new Error('lossless-missing-or-duplicate-table:' + table)
  }
  return match[0].rows
}
function immutable(row: Row): string {
  const { id: _id, fsrsShadow: _fsrs,
    reviewPolicyShadow: _policy, ...evidence } = row
  return stableWorkspaceJson(evidence)
}
function validId(id: unknown): id is number {
  return Number.isSafeInteger(id) && Number(id) > 0
}
function checkedUnion(
  input: Input, table: 'wordRecords' | 'reviewRecords',
  identity: 'attemptId' | 'sessionId',
): number {
  const legacy = new Map<number, string>()
  const expected = new Map<string, string | null>()
  const isWord = table === 'wordRecords'
  const evidence = (row: Row) => isWord ? immutable(row) : null
  for (const row of rows(input.ancestor, table)) {
    const id = row[identity]
    if (id === undefined) {
      if (!validId(row.id) || legacy.has(row.id)) {
        throw Error('lossless-ambiguous-legacy-ancestor:' + table)
      }
      legacy.set(row.id, stableWorkspaceJson(row))
    }
  }
  for (const snapshot of [input.ancestor, input.local, input.remote]) {
    const seen = new Set<string>()
    const seenNumeric = new Set<number>()
    for (const row of rows(snapshot, table)) {
      if (!validId(row.id) || seenNumeric.has(row.id)) {
        throw Error('lossless-invalid-source-primary-key:' + table)
      }
      seenNumeric.add(row.id)
      const id = row[identity]
      if (id === undefined) {
        if (legacy.get(row.id) !== stableWorkspaceJson(row)) {
          throw Error('lossless-new-or-changed-legacy:' + table)
        }
        continue
      }
      if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) {
        throw Error('lossless-invalid-source-uuid:' + table)
      }
      seen.add(id)
      const core = evidence(row)
      if (expected.has(id) && expected.get(id) !== core) {
        throw Error('lossless-contradictory-immutable-uuid:' + table)
      }
      expected.set(id, core)
    }
  }
  const present = new Set<string>()
  const candidateLegacy = new Set<number>()
  const seenNumeric = new Set<number>()
  for (const row of rows(input.candidate, table)) {
    if (!validId(row.id) || seenNumeric.has(row.id)) {
      throw Error('lossless-duplicate-candidate-primary-key:' + table)
    }
    seenNumeric.add(row.id)
    const id = row[identity]
    if (id === undefined) {
      if (legacy.get(row.id) !== stableWorkspaceJson(row)) {
        throw Error('lossless-rewritten-legacy:' + table)
      }
      candidateLegacy.add(row.id)
      continue
    }
    if (typeof id !== 'string' || !UUID.test(id) ||
        present.has(id) || !expected.has(id) ||
        expected.get(id) !== evidence(row)) {
      throw Error('lossless-invented-duplicate-or-rewritten-uuid:' + table)
    }
    present.add(id)
  }
  if (candidateLegacy.size !== legacy.size || present.size !== expected.size) {
    throw Error('lossless-missing-original-evidence:' + table)
  }
  return expected.size
}

/** Same UUID ReviewSession cursors may differ if a SEPARATE proven
 * three-way arbitration chooses one; this checks identity conservation only.
 */
export function auditV4LosslessEvidenceUnion(
  input: Input,
): V4LosslessEvidenceAudit {
  try {
    const owner = input.ancestor.metadata.source
    if (owner.kind !== 'account' || !owner.accountId ||
        [input.local, input.remote, input.candidate].some(snapshot =>
          snapshot.metadata.source.kind !== 'account' ||
          snapshot.metadata.source.accountId !== owner.accountId)) {
      throw Error('lossless-cross-account-or-anonymous-snapshot')
    }
    const uniqueAttempts = checkedUnion(input, 'wordRecords', 'attemptId')
    const sessionIds = checkedUnion(input, 'reviewRecords', 'sessionId')
    return { status: 'verified', uniqueAttempts, sessionIds,
      publishReady: false, convergenceComplete: false }
  } catch (error) {
    return { status: 'blocked',
      reason: error instanceof Error ? error.message : 'unknown',
      publishReady: false, convergenceComplete: false }
  }
}
