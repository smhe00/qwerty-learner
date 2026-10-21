/**
 * M4 crash-safe full V4 merge transaction kernel. NOT wired to app boot or
 * network. Caller must independently verify authenticated common ancestor,
 * six-table candidate, S1 owner and exclusive writer lock. This kernel never
 * establishes cloud convergence or authorizes an M2 read-only projection.
 */
import { assertRestorableWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

const SHA = /^[a-f0-9]{64}$/
export type PendingM4Merge = {
  version: 1
  accountId: string
  registryGeneration: number
  originalFingerprint: string
  candidateFingerprint: string
  original: WorkspaceSnapshotV4
  candidate: WorkspaceSnapshotV4
}
export type M4Decision = 'apply' | 'rollback'
export type M4JournalPort = {
  read(): Promise<PendingM4Merge | null>
  /** Atomically stage BOTH entire snapshots with S1 generation CAS. */
  stage(pending: PendingM4Merge): Promise<void>
  /** Atomically remove journal with CAS; keep rollback archive. */
  finalize(pending: PendingM4Merge, decision: M4Decision): Promise<void>
}
export type M4ReplicaPort = {
  capture(accountId: string): Promise<WorkspaceSnapshotV4>
  restore(snapshot: WorkspaceSnapshotV4, accountId: string): Promise<void>
  seal(): Promise<void>
}
export type M4Phase = 'capture' | 'stage' | 'restore' | 'verify' |
  'seal' | 'finalize' | 'complete'
const notify = (fn: ((p: M4Phase) => void) | undefined, phase: M4Phase) => {
  try { fn?.(phase) } catch { /* UI must never interrupt recovery */ }
}
function assertOwner(snapshot: WorkspaceSnapshotV4, accountId: string): void {
  assertRestorableWorkspaceV4(snapshot)
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== accountId) {
    throw new Error('m4-account-owner-mismatch')
  }
}
export async function validatePendingM4Merge(p: PendingM4Merge): Promise<void> {
  if (p.version !== 1 || !p.accountId || p.accountId.trim() !== p.accountId ||
      !Number.isSafeInteger(p.registryGeneration) || p.registryGeneration < 1 ||
      !SHA.test(p.originalFingerprint) || !SHA.test(p.candidateFingerprint)) {
    throw new Error('m4-invalid-transaction-identity')
  }
  assertOwner(p.original, p.accountId)
  assertOwner(p.candidate, p.accountId)
  const [oldFingerprint, nextFingerprint] = await Promise.all([
    workspaceFingerprintV4(p.original), workspaceFingerprintV4(p.candidate),
  ])
  if (oldFingerprint !== p.originalFingerprint ||
      nextFingerprint !== p.candidateFingerprint) {
    throw new Error('m4-journal-fingerprint-mismatch')
  }
}
async function verify(replica: M4ReplicaPort, accountId: string, expected: string) {
  const actual = await replica.capture(accountId)
  assertOwner(actual, accountId)
  if (await workspaceFingerprintV4(actual) !== expected) {
    throw new Error('m4-full-v4-readback-mismatch')
  }
}
/**
 * Pre-mount recovery under exclusive S1 writer lock. Explicit rollback uses
 * the ORIGINAL full six-table snapshot, including sessions and settings.
 * On any error the durable journal is retained, never deleted implicitly.
 */
export async function recoverM4Merge(
  journal: M4JournalPort, replica: M4ReplicaPort, decision: M4Decision,
  observer?: (phase: M4Phase) => void,
): Promise<boolean> {
  if (decision !== 'apply' && decision !== 'rollback') {
    throw new Error('m4-invalid-recovery-decision')
  }
  const pending = await journal.read()
  if (!pending) return false
  await validatePendingM4Merge(pending)
  const target = decision === 'apply' ? pending.candidate : pending.original
  const fingerprint = decision === 'apply'
    ? pending.candidateFingerprint : pending.originalFingerprint
  notify(observer, 'restore')
  await replica.restore(target, pending.accountId)
  notify(observer, 'verify')
  await verify(replica, pending.accountId, fingerprint)
  notify(observer, 'seal')
  await replica.seal()
  notify(observer, 'finalize')
  await journal.finalize(pending, decision)
  notify(observer, 'complete')
  return true
}
/**
 * This is intentionally NOT called by Learn, M3 or boot.
 * Refuses stale original snapshots and stages rollback BEFORE restore.
 */
export async function executeM4Merge(
  journal: M4JournalPort, replica: M4ReplicaPort,
  input: {
    accountId: string
    registryGeneration: number
    expectedOriginalFingerprint: string
    candidate: WorkspaceSnapshotV4
  },
  observer?: (phase: M4Phase) => void,
): Promise<void> {
  if (await journal.read()) throw new Error('m4-previous-merge-must-recover-first')
  notify(observer, 'capture')
  const original = await replica.capture(input.accountId)
  assertOwner(original, input.accountId)
  const originalFingerprint = await workspaceFingerprintV4(original)
  if (!SHA.test(input.expectedOriginalFingerprint) ||
      input.expectedOriginalFingerprint !== originalFingerprint) {
    throw new Error('m4-stale-local-source-no-write')
  }
  const pending: PendingM4Merge = {
    version: 1, accountId: input.accountId,
    registryGeneration: input.registryGeneration,
    original, originalFingerprint, candidate: input.candidate,
    candidateFingerprint: await workspaceFingerprintV4(input.candidate),
  }
  await validatePendingM4Merge(pending)
  notify(observer, 'stage')
  await journal.stage(pending)
  try {
    if (!(await recoverM4Merge(journal, replica, 'apply', observer))) {
      throw new Error('m4-journal-vanished')
    }
  } catch (cause) {
    // Never discard journal or rewrite original on failure; explicit recovery
    // under S1 writer lease chooses idempotent replay or rollback.
    throw new Error('m4-merge-interrupted-recovery-required', { cause })
  }
}
