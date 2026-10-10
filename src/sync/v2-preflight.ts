/**
 * S2 guarded manual-Sync preflight over ONE immutable V4 export.
 *
 * This module makes no request, does not import into RecordDB, and never
 * mutates the baseline. The future active executor must own the S1 Web Lock,
 * settle/flush all logical-word writers, capture the V4 snapshot, then call
 * this function. The decision is not transfer authorization by itself:
 * Push must use CAS and Pull must journal a verified revision before restore.
 */
import { workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { decideManualSyncV2 } from './v2-policy'
import type { SyncV2Baseline, SyncV2Decision, SyncV2RemoteMeta } from './v2-policy'

export type SyncV2Preflight = {
  localFingerprint: string
  hasMeaningfulState: boolean
  decision: SyncV2Decision
}

export function snapshotHasMeaningfulStateV4(snapshot: WorkspaceSnapshotV4): boolean {
  const data = snapshot.workspaceData
  const envelope = data.database as { data?: { data?: Array<{ rows?: unknown[] }> } }
  const tables = envelope.data?.data
  // Unknown Dexie export data shape cannot be safely treated as empty.
  if (!Array.isArray(tables) ||
      tables.some(table => !table || !Array.isArray(table.rows))) return true
  return Boolean(
    tables.some(table => (table.rows?.length ?? 0) > 0) ||
    Object.keys(data.learnRuntime.dailySessions).length > 0 ||
    Object.keys(data.settings.values).length > 0 ||
    data.navigation.currentDict !== 'zhongkaohexin' ||
    data.navigation.currentChapter !== 0,
  )
}

export async function preflightManualSyncV2(
  snapshot: WorkspaceSnapshotV4,
  authenticatedAccountId: string | null,
  remote: SyncV2RemoteMeta,
  baseline: SyncV2Baseline | null,
): Promise<SyncV2Preflight> {
  const localFingerprint = await workspaceFingerprintV4(snapshot)
  const hasMeaningfulState = snapshotHasMeaningfulStateV4(snapshot)
  return {
    localFingerprint,
    hasMeaningfulState,
    decision: decideManualSyncV2({
      activeWorkspace: snapshot.metadata.source,
      authenticatedAccountId,
      local: { logicalFingerprint: localFingerprint, hasMeaningfulState },
      remote,
      baseline,
    }),
  }
}
