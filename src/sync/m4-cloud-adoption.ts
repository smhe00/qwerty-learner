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
import { workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { LocalS2PullAncestor } from './m2-pinned-s2-ancestor'

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
    // This exact cloud snapshot MUST already contain all independently
    // identified local attempts, sessions, FSRS state and controls; when it
    // differs, the client must not silently lose local edits by adopting it.
    if (merged.candidateFingerprint !== actualCloud) {
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
