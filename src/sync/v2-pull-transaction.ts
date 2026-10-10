/**
 * Crash-replay kernel for a verified S2 Pull. Its IO implementation must
 * stage the immutable target durably before any RecordDB/localStorage write.
 * A failure after staging leaves the journal intact and blocks app mount
 * until complete replay. No cleanup-on-error; it could discard recovery data.
 */
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { SyncV2Baseline } from './v2-policy'

export type PendingSyncV2Pull = {
  version: 1
  accountId: string
  registryGeneration: number
  revision: number
  fingerprint: string
  oldBaseline: SyncV2Baseline | null
  snapshot: WorkspaceSnapshotV4
}

export type SyncV2PullPhase = 'staging' | 'restoring' | 'sealing' | 'committing' | 'complete'
export type PullJournalPort = {
  read(): Promise<PendingSyncV2Pull | null>
  stage(journal: PendingSyncV2Pull): Promise<void>
  finalize(journal: PendingSyncV2Pull): Promise<void>
}
export type PullReplicaPort = {
  restore(snapshot: WorkspaceSnapshotV4, accountId: string): Promise<void>
  seal(): Promise<void>
}

function notify(observer: ((stage: SyncV2PullPhase) => void) | undefined, stage: SyncV2PullPhase) {
  try { observer?.(stage) } catch { /* UI observer cannot abort durable transitions. */ }
}

export async function recoverSyncV2Pull(
  journal: PullJournalPort,
  replica: PullReplicaPort,
  observer?: (stage: SyncV2PullPhase) => void,
): Promise<boolean> {
  const pending = await journal.read()
  if (!pending) return false
  // Caller must own the exclusive working DB lease, with NO app mounted.
  // Journal is the authority even if restore previously partially succeeded.
  notify(observer, 'restoring')
  await replica.restore(pending.snapshot, pending.accountId)
  notify(observer, 'sealing')
  await replica.seal()
  notify(observer, 'committing')
  // Atomic baseline-CAS + journal deletion is owned by port.finalize.
  await journal.finalize(pending)
  notify(observer, 'complete')
  return true
}

export async function executeSyncV2Pull(
  journal: PullJournalPort,
  replica: PullReplicaPort,
  pending: PendingSyncV2Pull,
  observer?: (stage: SyncV2PullPhase) => void,
): Promise<void> {
  if (await journal.read()) {
    throw new Error('Previous S2 Pull journal requires recovery before any new transfer')
  }
  notify(observer, 'staging')
  await journal.stage(pending)
  try {
    if (!(await recoverSyncV2Pull(journal, replica, observer))) {
      throw new Error('S2 Pull journal vanished before durable restore')
    }
  } catch (cause) {
    throw new Error('S2 Pull interrupted: recover before any DB writer mounts', { cause })
  }
}
