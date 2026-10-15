/** Pre-mount, writer-locked, local-only Backup V4 import replay. */
import { refreshWorkspaceMigrationWitness } from './workspace-storage-witness'
import { manualV4ImportJournalPort } from './manual-v4-import-journal'
import { captureWorkingWorkspaceV4, restoreWorkingWorkspaceV4 } from './workspace-v4-browser'
import { canonicalWorkspaceData, workspaceFingerprintV4 } from './workspace-v4'

/**
 * Describe ONLY the structure path; never print backup values or learning
 * records to CI / diagnostics. This is an integrity error, not permission to
 * normalize away a changed field or to delete the journal.
 */
function firstDifferentPath(a: unknown, b: unknown, where = 'workspaceData'): string | null {
  if (Object.is(a, b)) return null
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return where
    if (a.length !== b.length) return where + '.length'
    for (let i = 0; i < a.length; i++) {
      const diff = firstDifferentPath(a[i], b[i], where + '[' + i + ']')
      if (diff !== null) return diff
    }
    return null
  }
  const isObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object'
  if (!isObject(a) || !isObject(b)) return where
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(a, key) ||
        !Object.prototype.hasOwnProperty.call(b, key)) return where + '.' + key
    const diff = firstDifferentPath(a[key], b[key], where + '.' + key)
    if (diff !== null) return diff
  }
  return null
}

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
    const path = firstDifferentPath(
      canonicalWorkspaceData(pending.snapshot.workspaceData),
      canonicalWorkspaceData(verified.workspaceData),
    )
    throw new Error('Manual V4 import restored payload differs from staged backup at ' +
      (path ?? 'canonical-serialization'))
  }
  refreshWorkspaceMigrationWitness()
  await manualV4ImportJournalPort.finalize(pending)
  sessionStorage.setItem('qwerty.s1.last-account-result',
    pending.purpose === 'clear-local-learning'
      ? '当前工作区的本地学习记录已清除，云端和其他账号工作区未改变。'
      : '本地完整 V4 恢复完成，云端尚未覆盖。请检查数据后再手动同步。')
  return true
}
