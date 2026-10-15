/**
 * S1-only local learning reset. This is a FULLY journaled V4 replacement of
 * the current working workspace, NOT a legacy RecordDB.clear() shortcut.
 *
 * The caller must own the pre-mount exclusive writer lease. No authenticated
 * identity, cloud account, other workspace snapshot, or settings are erased.
 */
import { DEFAULT_DICTIONARY_ID } from '@/resources/defaultDictionary'
import { loadAuth } from './auth'
import { manualV4ImportJournalPort } from './manual-v4-import-journal'
import { syncV2PullJournalPort } from './v2-pull-journal'
import { assertWorkspaceMigrationWitness } from './workspace-storage-witness'
import { same } from './workspace-transition'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import { assertRestorableWorkspaceV4, createWorkspaceV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { workspaceRegistryPort } from './workspace-vault'
import type { GuardedWorkspaceBoot } from './workspace-bootstrap'

/**
 * Preserve all manifest schemas and personal preferences while clearing the
 * six durable learning tables, Learn DailySessions, and navigation state.
 * Never alter the original snapshot, which the journal retains for rollback.
 */
export function clearedLearningWorkspaceV4(original: WorkspaceSnapshotV4): WorkspaceSnapshotV4 {
  assertRestorableWorkspaceV4(original)
  const next = structuredClone(original)
  const database = next.workspaceData.database as {
    data: {
      tables: Array<{ name: string; rowCount?: number }>
      data: Array<{ tableName: string; rows: unknown[] }>
    }
  }
  for (const table of database.data.tables) {
    if (typeof table.rowCount === 'number') table.rowCount = 0
  }
  for (const entry of database.data.data) entry.rows = []
  next.workspaceData.learnRuntime.dailySessions = {}
  next.workspaceData.navigation = { currentDict: DEFAULT_DICTIONARY_ID, currentChapter: 0 }
  return createWorkspaceV4(next.workspaceData, {
    source: structuredClone(original.metadata.source),
    createdAt: new Date().toISOString(),
  })
}

export async function stageClearLocalLearningData(boot: GuardedWorkspaceBoot): Promise<void> {
  if (boot.mode !== 'isolated' || boot.registry.pending || boot.registry.generation < 1) {
    throw new Error('清除操作必须在 S1 独占安全工作区中执行')
  }
  const owner = boot.registry.active
  const verifyOwner = async () => {
    const registry = await workspaceRegistryPort.read()
    const auth = loadAuth({ preserveExpired: true })
    const ownerMatchesAuth = owner.kind === 'anonymous'
      ? auth === null
      : auth?.user.userId === owner.accountId
    if (registry.pending || registry.generation !== boot.registry.generation ||
        !same(registry.active, owner) || !ownerMatchesAuth) {
      throw new Error('清除期间工作区或登录身份变化，未清除任何记录')
    }
    assertWorkspaceMigrationWitness()
  }

  await verifyOwner()
  if (await manualV4ImportJournalPort.read() || await syncV2PullJournalPort.read()) {
    throw new Error('上次本地恢复或同步事务尚未完成，请先恢复')
  }
  // Capture and audit all six durable tables BEFORE staging a single write.
  const original = await captureWorkingWorkspaceV4(owner)
  const candidate = clearedLearningWorkspaceV4(original)
  await verifyOwner()
  await manualV4ImportJournalPort.stage({
    owner,
    originalOwner: owner,
    registryGeneration: boot.registry.generation,
    original,
    candidate,
    purpose: 'clear-local-learning',
  })
  // The transaction journal + rollback snapshot now form the recovery
  // authority. Actual replacement must occur on the NEXT guarded boot.
}
