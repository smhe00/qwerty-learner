/**
 * Portable Backup V4 import contract. Account ID in a saved backup denotes
 * provenance, NOT a secret/credential and NOT permanent owner lock-in.
 *
 * No mutation or storage access here. This is deliberately separate from
 * the actual destructive S1 pre-mount import transaction and UI.
 */
import {
  assertRestorableWorkspaceV4,
  createWorkspaceV4,
  parseWorkspaceV4,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceIdentityV4, WorkspaceSnapshotV4 } from './workspace-v4'

export type PortableV4ImportPlan = {
  originalOwner: WorkspaceIdentityV4
  destinationOwner: WorkspaceIdentityV4
  originalCreatedAt: string
  contentFingerprint: string
  needsCrossOwnerConsent: boolean
  replacement: 'entire-current-local-workspace'
  cloudEffect: 'none'
}

export type PortableV4ImportConsent = {
  /** Local workspaces are FULLY replaced, never implicitly merged. */
  replaceCurrentLocal: true
  /** Must be acknowledged separately when source and target IDs differ. */
  acceptDifferentSourceOwner: boolean
  /** Typed destination immutable ID (or the literal LOCAL-ANONYMOUS). */
  destinationConfirmation: string
}

function ownerKey(owner: WorkspaceIdentityV4): string {
  if (owner.kind === 'anonymous') return 'anonymous'
  if (owner.kind !== 'account' || !owner.accountId ||
      owner.accountId.trim() !== owner.accountId) {
    throw new Error('Invalid immutable account ID in portable V4 import')
  }
  return 'account:' + owner.accountId
}

function typedDestination(owner: WorkspaceIdentityV4): string {
  return owner.kind === 'account' ? owner.accountId : 'LOCAL-ANONYMOUS'
}

/** Audit a complete V4 file; never silently reassign any account identity. */
export async function preparePortableV4Import(
  backupJson: string,
  currentOwner: WorkspaceIdentityV4,
): Promise<PortableV4ImportPlan> {
  ownerKey(currentOwner)
  const source = parseWorkspaceV4(backupJson)
  assertRestorableWorkspaceV4(source)
  return {
    originalOwner: structuredClone(source.metadata.source),
    destinationOwner: structuredClone(currentOwner),
    originalCreatedAt: source.metadata.createdAt,
    contentFingerprint: await workspaceFingerprintV4(source),
    needsCrossOwnerConsent: ownerKey(source.metadata.source) !== ownerKey(currentOwner),
    replacement: 'entire-current-local-workspace',
    cloudEffect: 'none',
  }
}

/**
 * Copy and change only the envelope ownership, after explicit consent.
 * Does not preserve the original account token, remote revision, sync
 * baseline, or credentials, as none belong in portable workspaceData.
 *
 * The caller MUST still stage the result into a durable S1 journal, perform
 * a WebLock-protected pre-mount replacement and invalidate target baseline.
 * Never call a working-DB restore directly from this helper.
 */
export async function rebindPortableV4Import(
  backupJson: string,
  plan: PortableV4ImportPlan,
  consent: PortableV4ImportConsent,
): Promise<WorkspaceSnapshotV4> {
  const parsed = parseWorkspaceV4(backupJson)
  assertRestorableWorkspaceV4(parsed)
  if (consent.replaceCurrentLocal !== true ||
      consent.destinationConfirmation !== typedDestination(plan.destinationOwner)) {
    throw new Error('V4 import requires explicit current-owner replacement confirmation')
  }
  if (ownerKey(plan.originalOwner) !== ownerKey(parsed.metadata.source) ||
      ownerKey(plan.destinationOwner) === '' ||
      (plan.needsCrossOwnerConsent && consent.acceptDifferentSourceOwner !== true) ||
      plan.needsCrossOwnerConsent !==
        (ownerKey(parsed.metadata.source) !== ownerKey(plan.destinationOwner))) {
    throw new Error('V4 import source/target identity or cross-account consent mismatch')
  }
  const before = await workspaceFingerprintV4(parsed)
  if (before !== plan.contentFingerprint ||
      parsed.metadata.createdAt !== plan.originalCreatedAt) {
    throw new Error('Portable Backup V4 changed after preview; re-inspect before import')
  }
  const candidate = createWorkspaceV4(structuredClone(parsed.workspaceData), {
    createdAt: new Date().toISOString(),
    source: structuredClone(plan.destinationOwner),
  })
  if (await workspaceFingerprintV4(candidate) !== before) {
    throw new Error('V4 owner rebinding modified learning records or settings')
  }
  return candidate
}
