import type {
  LocalState,
  RemoteSyncMeta,
  SyncAssessment,
  SyncAssessmentStatus,
  SyncBaseline,
} from './types'

const SYNC_STATE_PREFIX = 'qwerty.cloudSyncState.v1'

function keyForUser(userId: string) {
  return `${SYNC_STATE_PREFIX}.${userId}`
}

export function loadSyncBaseline(userId: string): SyncBaseline | null {
  try {
    const raw = localStorage.getItem(keyForUser(userId))
    if (!raw) return null

    const value = JSON.parse(raw) as Partial<SyncBaseline>
    if (
      !Number.isInteger(value.baseRevision) ||
      Number(value.baseRevision) < 0 ||
      typeof value.localFingerprint !== 'string' ||
      typeof value.syncedAt !== 'string'
    ) {
      return null
    }

    return value as SyncBaseline
  } catch {
    return null
  }
}

export function saveSyncBaseline(userId: string, baseRevision: number, localFingerprint: string) {
  const baseline: SyncBaseline = {
    baseRevision,
    localFingerprint,
    syncedAt: new Date().toISOString(),
  }

  localStorage.setItem(keyForUser(userId), JSON.stringify(baseline))
  return baseline
}

export function clearSyncBaseline(userId: string) {
  localStorage.removeItem(keyForUser(userId))
}

export function assessSyncState(
  local: LocalState,
  remote: RemoteSyncMeta,
  baseline: SyncBaseline | null,
): SyncAssessment {
  const baseRevision = baseline?.baseRevision ?? 0
  const localDirty = baseline
    ? local.fingerprint !== baseline.localFingerprint
    : local.hasMeaningfulState
  const remoteChanged = remote.revision !== baseRevision
  const diverged = localDirty && remoteChanged

  let status: SyncAssessmentStatus = 'clean'

  if (diverged) status = 'diverged'
  else if (localDirty) status = 'local-dirty'
  else if (remoteChanged) status = 'remote-ahead'

  return {
    status,
    localDirty,
    remoteChanged,
    diverged,
    baseRevision,
  }
}


export type LearnAutoSyncAction =
  | 'clean'
  | 'upload'
  | 'remote-ahead'
  | 'diverged'

/**
 * Pure policy used by completion auto-sync and verification tests.
 * Automatic sync may upload only when local changed and remote did not.
 */
export function decideLearnAutoSyncAction(
  assessment: SyncAssessment,
): LearnAutoSyncAction {
  if (assessment.diverged) return 'diverged'
  if (assessment.remoteChanged) return 'remote-ahead'
  if (!assessment.localDirty) return 'clean'
  return 'upload'
}
