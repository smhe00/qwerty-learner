/**
 * M4 post-CAS local adoption gate (read-only).
 *
 * A remote CAS write may already contain all of THIS browser's learning
 * edits. Only then may a separate, guarded S1 pre-mount caller stage the
 * verified cloud snapshot in the existing durable M4 rollback journal.
 *
 * This does NOT establish global multi-device event-head completeness,
 * authorize a cloud write, or itself touch RecordDB. The historical S2
 * ancestor pin MUST come from loadPinnedLocalS2PullAncestor; never mint
 * an ancestor from caller-provided local / cloud SHA equality.
 */
import { inspectPinnedV4FastForward } from './v4-fast-forward-preview'
import { previewDisjointWordV4 } from './v4-disjoint-word-candidate'
import { stableWorkspaceJson, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { LocalS2PullAncestor } from './m2-pinned-s2-ancestor'

type Row = Record<string, unknown>
function rows(snapshot: WorkspaceSnapshotV4, table: string): Row[] {
  const database = snapshot.workspaceData.database as {
    data: { data: Array<{ tableName: string; rows: Row[] }> }
  }
  const result = database.data.data.find(value => value.tableName === table)
  if (!result || !Array.isArray(result.rows)) throw Error('m4-adoption-incomplete-table:' + table)
  return result.rows
}
function attemptEvidence(row: Row): string {
  const { id: _id, fsrsShadow: _derived, reviewPolicyShadow: _policy, ...evidence } = row
  return stableWorkspaceJson(evidence)
}
function sessionEvidence(row: Row): string {
  const { id: _localId, ...content } = row
  return stableWorkspaceJson(content)
}
/**
 * The full-six-table projection has separately validated immutable
 * ancestor rows, FSRS replay and ReviewSession ancestry. Here require
 * actual materialized cloud content to contain every LOCAL UUID, session
 * and progress state before staging the cloud bytes for destructive import.
 * Cannot equate local numeric IDs for new rows from two devices.
 */
function cloudRetainsLocal(
  local: WorkspaceSnapshotV4, cloud: WorkspaceSnapshotV4,
  projected: WorkspaceSnapshotV4,
): boolean {
  const cloudAttempts = new Map(rows(cloud, 'wordRecords')
    .filter(row => typeof row.attemptId === 'string')
    .map(row => [row.attemptId, attemptEvidence(row)]))
  for (const row of rows(local, 'wordRecords')) {
    if (typeof row.attemptId === 'string') {
      if (cloudAttempts.get(row.attemptId) !== attemptEvidence(row)) return false
    } else {
      const match = rows(cloud, 'wordRecords').find(r => r.id === row.id)
      if (!match || stableWorkspaceJson(match) !== stableWorkspaceJson(row)) return false
    }
  }
  const cloudSessions = new Map(rows(cloud, 'reviewRecords')
    .filter(row => typeof row.sessionId === 'string')
    .map(row => [row.sessionId, sessionEvidence(row)]))
  for (const session of rows(local, 'reviewRecords')) {
    if (typeof session.sessionId === 'string') {
      if (cloudSessions.get(session.sessionId) !== sessionEvidence(session)) return false
    } else {
      const match = rows(cloud, 'reviewRecords').find(r => r.id === session.id)
      if (!match || stableWorkspaceJson(match) !== stableWorkspaceJson(session)) return false
    }
  }
  const stateKey = (r: Row) => JSON.stringify([r.dict, r.word])
  const cloudStates = new Map(rows(cloud, 'reviewWordStates')
    .map(row => [stateKey(row), row]))
  for (const state of rows(local, 'reviewWordStates')) {
    const current = cloudStates.get(stateKey(state))
    if (!current || !Number.isSafeInteger(current.reviewCount) ||
        !Number.isSafeInteger(state.reviewCount) ||
        (current.reviewCount as number) < (state.reviewCount as number)) return false
  }
  return stableWorkspaceJson(projected.workspaceData.settings) ===
      stableWorkspaceJson(cloud.workspaceData.settings) &&
    stableWorkspaceJson(projected.workspaceData.navigation) ===
      stableWorkspaceJson(cloud.workspaceData.navigation) &&
    stableWorkspaceJson(projected.workspaceData.learnRuntime) ===
      stableWorkspaceJson(cloud.workspaceData.learnRuntime)
}

export type M4CloudAdoptionGate =
  | { status: 'blocked'; reason: string; admissionReady: false;
      convergenceComplete: false }
  | { status: 'verified-candidate'; reason: 'remote-fast-forward' |
      'cloud-already-contains-local-merge'; admissionReady: true;
      convergenceComplete: false; candidate: WorkspaceSnapshotV4;
      candidateFingerprint: string; originalFingerprint: string;
      cloudRevision: number }

const denied = (reason: string): M4CloudAdoptionGate =>
  ({ status: 'blocked', reason, admissionReady: false,
    convergenceComplete: false })
const SHA = /^[a-f0-9]{64}$/

/**
 * Assumes caller separately downloaded and authenticated exact cloud V4
 * bytes. Hash both records again, and prove either local is unchanged from
 * an independently pinned S2 ancestor, or the existing complete-six-table
 * deterministic projection is EXACTLY the cloud bytes. No unilateral push.
 */
export async function inspectM4CloudAdoption(input: {
  accountId: string
  pin: LocalS2PullAncestor | null
  local: WorkspaceSnapshotV4
  verifiedCloud: WorkspaceSnapshotV4
  cloudRevision: number
  cloudFingerprint: string
}): Promise<M4CloudAdoptionGate> {
  const { accountId, pin, local, verifiedCloud, cloudRevision,
    cloudFingerprint } = input
  if (!accountId || accountId.trim() !== accountId ||
      !pin || pin.status !== 'pinned-local-s2-pull-only' ||
      pin.accountId !== accountId || pin.publishReady !== false ||
      pin.convergenceComplete !== false || !SHA.test(pin.fingerprint) ||
      !SHA.test(cloudFingerprint) ||
      !Number.isSafeInteger(cloudRevision) ||
      cloudRevision <= pin.revision) {
    return denied('m4-adoption-authenticated-ancestor-or-newer-cloud-required')
  }
  try {
    const [originalFingerprint, actualCloud, actualPin] = await Promise.all([
      workspaceFingerprintV4(local),
      workspaceFingerprintV4(verifiedCloud),
      workspaceFingerprintV4(pin.snapshot),
    ])
    if (actualPin !== pin.fingerprint || actualCloud !== cloudFingerprint) {
      return denied('m4-adoption-cloud-or-ancestor-fingerprint-mismatch')
    }
    const previewInput = {
      accountId, pinnedAncestorFingerprint: pin.fingerprint,
      ancestor: pin.snapshot, local, remote: verifiedCloud,
    }
    const ff = await inspectPinnedV4FastForward(previewInput)
    if (ff.status === 'projected') {
      if (ff.selected !== 'remote') {
        return denied('m4-adoption-cloud-does-not-advance-local')
      }
      return { status: 'verified-candidate',
        reason: 'remote-fast-forward', admissionReady: true,
        convergenceComplete: false, candidate: structuredClone(verifiedCloud),
        candidateFingerprint: actualCloud, originalFingerprint, cloudRevision }
    }
    if (ff.reason !== 'both-devices-changed-requires-six-table-merge') {
      return denied('m4-adoption-fast-forward:' + ff.reason)
    }
    const merged = await previewDisjointWordV4(previewInput)
    if (merged.status !== 'projected') {
      return denied('m4-adoption-six-table:' + merged.reason)
    }
    // Re-projecting cloud+cloud can change WHICH acquisition-only words
    // count as "overlapping", synthesizing FSRS derived rows not present in
    // the raw published V4. Instead compare every LOCAL immutable attempt
    // and ReviewSession with the *materialized* cloud content, verify
    // monotonic scheduler counts, and require controls/runtime to equal
    // the six-table projection. Fail closed for any missing local evidence.
    if (!cloudRetainsLocal(local, verifiedCloud, merged.candidate)) {
      return denied('m4-adoption-cloud-missing-local-merge')
    }
    return { status: 'verified-candidate',
      reason: 'cloud-already-contains-local-merge', admissionReady: true,
      convergenceComplete: false, candidate: structuredClone(verifiedCloud),
      candidateFingerprint: actualCloud, originalFingerprint, cloudRevision }
  } catch (error) {
    return denied('m4-adoption-unverified:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
