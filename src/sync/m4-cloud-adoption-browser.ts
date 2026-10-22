/**
 * ETESТ-only M4 verified cloud adoption: pre-mount and dormant by default.
 *
 * This is NOT a mounted UI action. Caller must hold the S1 lifetime writer
 * lease returned by prepareGuardedWorkspaceBoot(), with no app initialized.
 * On success only the immutable journal is STAGED; a fresh page load
 * replays it via existing workspace-bootstrap M4 crash recovery before
 * any user writer mounts. Production does not enable this entry.
 */
import { getSyncV2Meta, getSyncV2SnapshotBinary } from './api'
import { loadAuth } from './auth'
import { inspectM4CloudAdoption } from './m4-cloud-adoption'
import { loadPinnedLocalS2PullAncestor } from './m2-pinned-s2-ancestor'
import { m4MergeJournalPort } from './m4-merge-journal'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { workspaceRegistryPort } from './workspace-vault'
import { verifyDownloadedWorkspaceV4 } from './v2-verify-remote'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'
import type { RemoteSyncMeta } from './types'

const sameMeta = (a: RemoteSyncMeta, b: RemoteSyncMeta) =>
  a.hasData === b.hasData && a.revision === b.revision &&
  a.clientFormatVersion === b.clientFormatVersion &&
  a.logicalFingerprint === b.logicalFingerprint &&
  a.payloadSha256 === b.payloadSha256 &&
  a.sizeBytes === b.sizeBytes

export type M4AdoptionStageResult =
  | { status: 'blocked'; reason: string }
  | { status: 'staged-reload-required'; revision: number;
      fingerprint: string; convergenceComplete: false }

export async function stageEtestPreMountM4CloudAdoption(
  boot: GuardedWorkspaceBoot,
): Promise<M4AdoptionStageResult> {
  if (typeof window === 'undefined' ||
      window.location.hostname !== 'etest.edgeone.dev' ||
      import.meta.env.VITE_QWERTY_M4_ADOPTION_PILOT !== 'true') {
    return { status: 'blocked', reason: 'm4-adoption-pilot-disabled' }
  }
  if (boot.mode !== 'isolated' || boot.registry.pending !== null ||
      boot.registry.generation < 1 || boot.registry.active.kind !== 'account') {
    return { status: 'blocked', reason: 'm4-adoption-pre-mount-s1-lease-required' }
  }
  const accountId = boot.registry.active.accountId
  const auth = loadAuth({ preserveExpired: true })
  if (!auth || auth.user.userId !== accountId || !auth.token ||
      auth.expiresAt * 1000 <= Date.now()) {
    return { status: 'blocked', reason: 'm4-adoption-auth-required' }
  }
  const token = auth.token
  const owner = async () => {
    const [registry, current] = await Promise.all([
      workspaceRegistryPort.read(), Promise.resolve(loadAuth({ preserveExpired: true })),
    ])
    if (registry.generation !== boot.registry.generation ||
        registry.pending !== null || registry.active.kind !== 'account' ||
        registry.active.accountId !== accountId ||
        current?.user.userId !== accountId || current.token !== token ||
        current.expiresAt * 1000 <= Date.now()) {
      throw new Error('m4-adoption-s1-owner-or-account-changed')
    }
    assertWorkspaceMigrationWitness()
  }
  await owner()
  const pin = await loadPinnedLocalS2PullAncestor(accountId)
  await owner()
  if (!pin) return { status: 'blocked', reason: 'm4-adoption-no-s2-pull-ancestor' }
  // Capture is permitted ONLY while the caller owns the pre-mount writer
  // lease. Do not import/mount React while this function is in progress.
  const local = await captureWorkingWorkspaceV4({ kind: 'account', accountId })
  await owner()
  const meta = await getSyncV2Meta(token)
  await owner()
  if (!meta.hasData || !meta.logicalFingerprint ||
      meta.revision <= pin.revision) {
    return { status: 'blocked', reason: 'm4-adoption-no-newer-cloud-snapshot' }
  }
  const payload = await getSyncV2SnapshotBinary(token)
  const cloud = await verifyDownloadedWorkspaceV4(accountId, meta, payload)
  await owner()
  const again = await getSyncV2Meta(token)
  if (!sameMeta(meta, again)) {
    return { status: 'blocked', reason: 'm4-adoption-cloud-revision-changed' }
  }
  const decision = await inspectM4CloudAdoption({
    accountId, pin, local, verifiedCloud: cloud,
    cloudRevision: meta.revision, cloudFingerprint: meta.logicalFingerprint,
  })
  if (decision.status !== 'verified-candidate') {
    return { status: 'blocked', reason: decision.reason }
  }
  await owner()
  // Stage both ORIGINAL and verified cloud candidate atomically in the
  // EXISTING M4 vault; bootstrap owns the crash-safe restoration on reload.
  await m4MergeJournalPort.stage({
    version: 1, accountId, registryGeneration: boot.registry.generation,
    original: local, originalFingerprint: decision.originalFingerprint,
    candidate: decision.candidate,
    candidateFingerprint: decision.candidateFingerprint,
  })
  return { status: 'staged-reload-required', revision: decision.cloudRevision,
    fingerprint: decision.candidateFingerprint, convergenceComplete: false }
}
