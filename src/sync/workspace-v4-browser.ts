/**
 * S1-only workspace capture/restore adapter. NOT connected to Cloud Sync V1
 * or user UI. Caller MUST hold the cross-tab writer lock and quiesce all DB
 * writers for capture, restore, and activation. A boot-time pending journal
 * MUST recover before the working DB is writable.
 */
import {
  captureWorkspaceSettings,
  captureDailySessions,
  createWorkspaceV4,
  migrateV3ToWorkspaceV4,
  parseWorkspaceV4,
  WORKSPACE_SETTING_KEYS,
  DAILY_SESSION_PREFIX,
} from './workspace-v4'
import type { WorkspaceIdentityV4, WorkspaceSnapshotV4 } from './workspace-v4'
import {
  BACKUP_FORMAT_VERSION,
  exportBackupJson,
  importBackupJson,
  resetReviewModeInfoAfterRestore,
  restoreLearningState,
} from '@/utils/backup'
import { clearAllLearnDailySessions } from '@/learn/daily-session'
import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'
import { db } from '@/utils/db/core'

export async function captureWorkingWorkspaceV4(
  source: WorkspaceIdentityV4,
): Promise<WorkspaceSnapshotV4> {
  // Flush the known serialized Learn ReviewRecord writer. This is not a
  // substitute for the external cross-tab lock and all-writer quiescence.
  await flushReviewRecordWrites()
  const v3 = await exportBackupJson()
  return migrateV3ToWorkspaceV4(v3, {
    source,
    createdAt: new Date().toISOString(),
  }, { storage: localStorage })
}

function clearWorkspaceStorage(): void {
  clearAllLearnDailySessions()
  for (const key of WORKSPACE_SETTING_KEYS) localStorage.removeItem(key)
  resetReviewModeInfoAfterRestore()
}

function applyWorkspaceStorage(snapshot: WorkspaceSnapshotV4): void {
  clearWorkspaceStorage()
  for (const [key, value] of Object.entries(snapshot.workspaceData.settings.values)) {
    localStorage.setItem(key, JSON.stringify(value))
  }
  for (const [dict, session] of Object.entries(
    snapshot.workspaceData.learnRuntime.dailySessions,
  )) {
    localStorage.setItem(DAILY_SESSION_PREFIX + dict, JSON.stringify(session))
  }
  restoreLearningState(snapshot.workspaceData.navigation)
}

/**
 * Full replacement for a verified S1 vault snapshot, never implicit merge.
 * A partial DB or localStorage restore MUST be replayed from the immutable
 * vault under a durable pending journal before any user write is allowed.
 */
export async function restoreWorkingWorkspaceV4(
  snapshot: WorkspaceSnapshotV4,
  expectedSource: WorkspaceIdentityV4,
): Promise<void> {
  const checked = parseWorkspaceV4(JSON.stringify(snapshot))
  const actual = checked.metadata.source
  const matches = actual.kind === expectedSource.kind &&
    (actual.kind === 'anonymous' ||
      (expectedSource.kind === 'account' && actual.accountId === expectedSource.accountId))
  if (!matches) throw new Error('Cross-workspace restore refused without explicit import consent')

  // Reuse the audited V3 database import path for the durable tables. V1
  // remains V3-only; this conversion happens solely within the S1 adapter.
  const legacyEnvelope = JSON.stringify({
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    learningState: checked.workspaceData.navigation,
    database: checked.workspaceData.database,
  })
  await importBackupJson(legacyEnvelope, { clientFormatVersion: BACKUP_FORMAT_VERSION })
  applyWorkspaceStorage(checked)
}

/** Empty workspace activation requires the same external lock/journal. */
export async function resetWorkingWorkspaceToEmpty(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
  clearWorkspaceStorage()
  restoreLearningState({ currentDict: 'zhongkaohexin', currentChapter: 0 })
}
