/**
 * Inactive M4 browser recovery adapter.
 *
 * This module MUST run pre-mount, while holding the S1 exclusive writer
 * lease and after all RecordDB writers have stopped. It is deliberately NOT
 * invoked from workspace-bootstrap, cloud settings, Learn or mobile code.
 * Do not activate until authenticated M2 ancestry, full six-table candidate,
 * S1 generation ownership and recovery gates have passed.
 *
 * Explicit apply or rollback; never infer success from absence of a remote
 * batch or use last-writer-wins. Both choices verify a full restored V4.
 */
import { m4MergeJournalPort } from './m4-merge-journal'
import { recoverM4Merge } from './m4-merge-transaction'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import type { M4Decision } from './m4-merge-transaction'

export async function recoverPendingM4Merge(decision: M4Decision): Promise<boolean> {
  return recoverM4Merge(m4MergeJournalPort, {
    capture: async (accountId) => captureWorkingWorkspaceV4({
      kind: 'account', accountId,
    }),
    restore: async (snapshot, accountId) =>
      restoreWorkingWorkspaceV4(snapshot, { kind: 'account', accountId }),
    seal: async () => { refreshWorkspaceMigrationWitness() },
  }, decision)
}
