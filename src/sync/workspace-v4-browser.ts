/**
 * S1-only workspace capture/restore adapter. NOT connected to Cloud Sync V1
 * or user UI. Caller MUST hold the cross-tab writer lock and quiesce all DB
 * writers for capture, restore, and activation. A boot-time pending journal
 * MUST recover before the working DB is writable.
 */
import {
  DAILY_SESSION_PREFIX,
  WORKSPACE_SETTING_KEYS,
  assertRestorableWorkspaceV4,
  captureDailySessions,
  captureWorkspaceSettings,
  createWorkspaceV4,
  parseWorkspaceV4,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceIdentityV4, WorkspaceSnapshotV4 } from './workspace-v4'
import { assertV4SourceRowsMatchExport } from './v4-table-audit'
import {
  readLearningState,
  resetReviewModeInfoAfterRestore,
  restoreLearningState,
} from '@/utils/backup'
import { clearAllLearnDailySessions } from '@/learn/daily-session'
import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'
import { db } from '@/utils/db/core'
import Dexie from 'dexie'
import { timePerfStage } from './perf-diagnostics'
import { secureRandomUuid } from './sha256-compat'
import type { PerfFlow } from './perf-diagnostics'

/**
 * Last-resort independent lossless audit. Dexie Export/Import uses Typeson,
 * whose userObject/array/undefined/special type rules vary by library version.
 * Do NOT guess at or erase unknown $types markers to make a hash compare pass.
 *
 * Only when the fast source/export comparison sees a payload mismatch,
 * round-trip the ORIGINAL exported database to a fresh, isolated temporary
 * IndexedDB, then compare all six decoded raw tables with the live source.
 * A change, missing row or failed decoder still fails closed. Never import
 * into the actual RecordDB or change the archive about to be downloaded.
 */
async function verifyV4RoundTripInDisposableDatabase(
  snapshot: WorkspaceSnapshotV4,
  sourceRows: Parameters<typeof assertV4SourceRowsMatchExport>[1],
): Promise<void> {
  const original = snapshot.workspaceData.database as {
    formatName: string
    formatVersion: number
    data: {
      databaseName: string
      databaseVersion: number
      tables: Array<{ name: string; schema: string; rowCount?: number }>
      data: Array<{ tableName: string; rows: unknown[] }>
    }
  }
  const name = 'qwerty-v4-export-audit-' + secureRandomUuid()
  const shadow = new Dexie(name)
  try {
    const stores = Object.fromEntries(original.data.tables.map(table =>
      [table.name, table.schema]))
    shadow.version(original.data.databaseVersion).stores(stores)
    // The raw Dexie export is the ONLY imported data. In particular, never
    // discard the exporter $types metadata needed for faithful reconstruction.
    const isolatedExport = {
      ...original,
      data: { ...original.data, databaseName: name },
    }
    await shadow.import(new Blob([JSON.stringify(isolatedExport)], {
      type: 'application/json',
    }), {
      acceptNameDiff: false,
      acceptVersionDiff: true,
      acceptMissingTables: false,
      acceptChangedPrimaryKey: false,
      clearTablesBeforeImport: true,
    })
    const roundTripped = structuredClone(snapshot)
    const tables = (roundTripped.workspaceData.database as typeof original).data.data
    for (const table of tables) {
      if (!(table.tableName in sourceRows)) continue
      table.rows = await shadow.table(table.tableName).toCollection().raw().toArray()
    }
    await assertV4SourceRowsMatchExport(roundTripped, sourceRows)
  } finally {
    shadow.close()
    await shadow.delete()
  }
}

export async function captureWorkingWorkspaceV4(
  source: WorkspaceIdentityV4,
  diagnosticFlow?: PerfFlow,
): Promise<WorkspaceSnapshotV4> {
  const timed = <T>(stage: string, work: () => Promise<T>): Promise<T> =>
    diagnosticFlow ? timePerfStage(diagnosticFlow, stage, work) : work()
  // Flush the known serialized Learn ReviewRecord writer. This is not a
  // substitute for the external cross-tab lock and all-writer quiescence.
  await flushReviewRecordWrites()
  const databaseBlob = await timed('dexie-export', () => db.export())
  const snapshot = createWorkspaceV4({
    database: JSON.parse(await databaseBlob.text()),
    learnRuntime: { dailySessions: captureDailySessions(localStorage) },
    settings: captureWorkspaceSettings(localStorage),
    navigation: readLearningState(),
  }, {
    source,
    createdAt: new Date().toISOString(),
  })
  // Counts are read from actual RecordDB, not from the serialized export.
  // This fails closed if an incomplete export omits rows from a live table.
  const entries = await timed('source-rows-read', () => Promise.all(
    db.tables.filter(table => [
      'wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates',
      'achievementEvents', 'achievementStates',
    ].includes(table.name)).map(async table =>
      // Use the raw stored row, not Dexie's mapped WordRecord class.
      // Mapping constructors may rehydrate computed/default fields that
      // do not exist in IndexedDB and must not be mistaken for corruption.
      [table.name, await table.toCollection().raw().toArray()] as const),
  ))
  // Count-only comparisons miss same-count substitutions (e.g. a damaged
  // FSRS interval); independently hash full live Dexie rows as well.
  const sourceRows = Object.fromEntries(entries) as
    Parameters<typeof assertV4SourceRowsMatchExport>[1]
  try {
    await timed('source-rows-audit', () => assertV4SourceRowsMatchExport(snapshot, sourceRows))
  } catch (error) {
    // Only a payload mismatch can have a reversible Typeson representation.
    // A row-count mismatch, malformed archive, or damaged source still fails.
    if (!(error instanceof Error) ||
        !error.message.startsWith('Backup V4 source/export row-payload mismatch:')) {
      throw error
    }
    await timed('fallback-roundtrip-audit', () =>
      verifyV4RoundTripInDisposableDatabase(snapshot, sourceRows))
  }
  return snapshot
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
  assertRestorableWorkspaceV4(checked)
  const actual = checked.metadata.source
  const matches = actual.kind === expectedSource.kind &&
    (actual.kind === 'anonymous' ||
      (expectedSource.kind === 'account' && actual.accountId === expectedSource.accountId))
  if (!matches) throw new Error('Cross-workspace restore refused without explicit import consent')

  // Import V4's validated Dexie payload directly. No V3 envelope,
  // conversion or legacy partial-table recovery path is involved.
  await db.import(new Blob([JSON.stringify(checked.workspaceData.database)], {
    type: 'application/json',
  }), {
    acceptVersionDiff: true,
    acceptMissingTables: false,
    acceptNameDiff: false,
    acceptChangedPrimaryKey: false,
    overwriteValues: true,
    clearTablesBeforeImport: true,
  })
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
