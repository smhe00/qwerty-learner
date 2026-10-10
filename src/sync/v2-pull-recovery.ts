/**
 * S2 pre-mount Pull crash recovery. The owning tab must already hold the
 * S1 Web Lock. No app/React/RecordDB writer may have mounted yet.
 *
 * A future UI executor may stage a verified Pull only after saving the
 * current local V4 snapshot to the account vault and quiescing all writers.
 * This recovery entry deliberately performs NO network request.
 */
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { workspaceFingerprintV4 } from './workspace-v4'
import { syncV2PullJournalPort } from './v2-pull-journal'
import { recoverSyncV2Pull } from './v2-pull-transaction'

export async function recoverPendingSyncV2Pull(): Promise<boolean> {
  return recoverSyncV2Pull(syncV2PullJournalPort, {
    restore: async (snapshot, accountId) => {
      const owner = { kind: 'account' as const, accountId }
      await restoreWorkingWorkspaceV4(snapshot, owner)
      // Verify the ACTUAL restored RecordDB, daily sessions, settings and
      // navigation before seal + atomic baseline/journal finalization.
      // A partial/incorrect import must leave the journal pending.
      const restored = await captureWorkingWorkspaceV4(owner)
      const [expected, actual] = await Promise.all([
        workspaceFingerprintV4(snapshot),
        workspaceFingerprintV4(restored),
      ])
      if (expected !== actual) {
        throw new Error('S2 Pull restored workspace does not match staged V4 fingerprint')
      }
    },
    seal: async () => { refreshWorkspaceMigrationWitness() },
  })
}
