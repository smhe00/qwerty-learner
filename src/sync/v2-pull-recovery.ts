/**
 * S2 pre-mount Pull crash recovery. The owning tab must already hold the
 * S1 Web Lock. No app/React/RecordDB writer may have mounted yet.
 *
 * A future UI executor may stage a verified Pull only after saving the
 * current local V4 snapshot to the account vault and quiescing all writers.
 * This recovery entry deliberately performs NO network request.
 */
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { syncV2PullJournalPort } from './v2-pull-journal'
import { recoverSyncV2Pull } from './v2-pull-transaction'

export async function recoverPendingSyncV2Pull(): Promise<boolean> {
  return recoverSyncV2Pull(syncV2PullJournalPort, {
    restore: (snapshot, accountId) => restoreWorkingWorkspaceV4(
      snapshot, { kind: 'account', accountId },
    ),
    seal: async () => { refreshWorkspaceMigrationWitness() },
  })
}
