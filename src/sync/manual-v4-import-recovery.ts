/** Pre-mount, writer-locked, local-only Backup V4 import replay. */
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { manualV4ImportJournalPort } from './manual-v4-import-journal'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { workspaceFingerprintV4 } from './workspace-v4'

/**
 * Idempotent: a crash at any point before journal finalization replays the
 * complete immutable target, never resumes a partial Dexie table import.
 * Import result becomes visible ONLY after verified replay + baseline reset.
 */
export async function recoverPendingManualV4Import(): Promise<boolean> {
  const pending = await manualV4ImportJournalPort.read()
  if (!pending) return false
  await restoreWorkingWorkspaceV4(pending.snapshot, pending.owner)
  const verified = await captureWorkingWorkspaceV4(pending.owner)
  if (await workspaceFingerprintV4(verified) !== pending.fingerprint) {
    throw new Error('Manual V4 import restored payload differs from staged backup')
  }
  refreshWorkspaceMigrationWitness()
  await manualV4ImportJournalPort.finalize(pending)
  sessionStorage.setItem('qwerty.s1.last-account-result',
    '本地完整 V4 恢复完成，云端尚未覆盖。请检查数据后再手动同步。')
  return true
}
