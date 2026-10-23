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
  stableWorkspaceJson,
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
import { applyRecordClassMappings, db } from '@/utils/db/core'
import Dexie from 'dexie'
import { timePerfStage } from './perf-diagnostics'
import { sameLosslessIndexedDbValue } from './m4-lossless-idb-compare'
import { secureRandomUuid } from './sha256-compat'
import { DEFAULT_DICTIONARY_ID } from '@/resources/defaultDictionary'
import type { PerfFlow } from './perf-diagnostics'

/**
 * JSON hashes cannot distinguish +0 from -0, even though IndexedDB
 * structured clone can. A fast row-payload audit may therefore pass
 * despite a destructive ExportImport conversion. When ANY stored row
 * contains negative zero, require the independent lossless IDB readback
 * before claiming that the V4 archive is restorable.
 *
 * Only enumerable persisted properties are traversed; cyclic aliases are
 * visited once. Excessive nesting or object count blocks, never approves.
 */
function sourceContainsNegativeZero(rows: Record<string, unknown[]>): boolean {
  const seen = new WeakSet<object>()
  let inspected = 0
  const check = (value: unknown, depth: number): boolean => {
    if (Object.is(value, -0)) return true
    if (value === null || typeof value !== 'object') return false
    if (seen.has(value)) return false
    if (++inspected > 2_000_000 || depth > 100) {
      throw new Error('Backup V4 source contains unbounded special-number graph')
    }
    seen.add(value)
    return Object.keys(value).some(field =>
      check((value as Record<string, unknown>)[field], depth + 1))
  }
  return Object.values(rows).some(value => check(value, 0))
}

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
    // The fast audit is deliberately JSON/canonical-payload based. It can
    // reject an otherwise faithful Typeson export if a persisted ReviewRecord
    // has shared Word[] objects or other losslessly cloneable IDB values.
    // The fallback must compare the ACTUAL imported IDB rows, not pass those
    // rows through the same JSON normalization that already failed.
    //
    // Pair rows by durable primary key: row order is not data evidence.
    // A missing, duplicate or changed row blocks even if counts happen to
    // match. This path never touches the real RecordDB or rewrites the export.
    const keyOf = (row: unknown): string | null => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null
      const record = row as Record<string, unknown>
      const key = record.id ?? record.eventId ?? record.achievementId
      if ((typeof key !== 'string' || key.length === 0) &&
          (typeof key !== 'number' || !Number.isSafeInteger(key))) return null
      return typeof key + ':' + String(key)
    }
    for (const name of Object.keys(sourceRows) as Array<keyof typeof sourceRows>) {
      const originalRows = sourceRows[name]
      const restoredRows = await shadow.table(name).toCollection().raw().toArray()
      if (originalRows.length !== restoredRows.length) {
        throw new Error('Backup V4 independent roundtrip row-count mismatch: ' + name)
      }
      const restoredByKey = new Map<string, unknown>()
      for (const row of restoredRows) {
        const key = keyOf(row)
        if (key === null || restoredByKey.has(key)) {
          throw new Error('Backup V4 independent roundtrip invalid key: ' + name)
        }
        restoredByKey.set(key, row)
      }
      const seen = new Set<string>()
      for (const sourceRow of originalRows) {
        const key = keyOf(sourceRow)
        if (key === null || seen.has(key) || !restoredByKey.has(key)) {
          throw new Error('Backup V4 independent roundtrip missing row: ' + name)
        }
        seen.add(key)
        if (!sameLosslessIndexedDbValue(sourceRow, restoredByKey.get(key))) {
          // Diagnostic field NAMES ONLY. Never include primary keys, word
          // contents, array elements, or account/device identifiers.
          const originalFields = sourceRow as Record<string, unknown>
          const restoredFields = restoredByKey.get(key) as Record<string, unknown>
          const fields = Array.from(new Set([
            ...Object.keys(originalFields), ...Object.keys(restoredFields),
          ])).sort()
          const changed = fields.find(field =>
            !Object.prototype.hasOwnProperty.call(originalFields, field) ||
            !Object.prototype.hasOwnProperty.call(restoredFields, field) ||
            !sameLosslessIndexedDbValue(originalFields[field], restoredFields[field]))
          // Follow only validated FIELD NAMES (never values or row keys)
          // to isolate an unsupported Typeson conversion. Depth is bounded.
          const safeName = (input: string): string =>
            /^[a-zA-Z][a-zA-Z0-9]{0,50}$/.test(input) ? input :
              /^(0|[1-9][0-9]{0,3})$/.test(input) ? 'element' : 'field'
          let left: unknown = changed ? originalFields[changed] : originalFields
          let right: unknown = changed ? restoredFields[changed] : restoredFields
          const parts = [safeName(changed ?? 'unknown')]
          for (let depth = 0; depth < 5; depth++) {
            if (!left || !right || typeof left !== 'object' ||
                typeof right !== 'object') break
            const a = left as Record<string, unknown>
            const b = right as Record<string, unknown>
            const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()
            const delta = keys.find(k =>
              !Object.prototype.hasOwnProperty.call(a, k) ||
              !Object.prototype.hasOwnProperty.call(b, k) ||
              !sameLosslessIndexedDbValue(a[k], b[k]))
            if (delta === undefined) break
            parts.push(safeName(delta))
            left = a[delta]
            right = b[delta]
          }
          throw new Error('Backup V4 independent roundtrip value mismatch: ' +
            name + ' fields ' + parts.join('.'))
        }
      }
    }
  } finally {
    shadow.close()
    await shadow.delete()
  }
}

/**
 * Materialize an M4 merge candidate through an ISOLATED temporary Dexie DB
 * before staging any restore to the real RecordDB. A V4 export contains
 * Typeson $types descriptors, while incoming M3 records are plain JSON.
 * Combining those representations by hand does not produce canonical V4
 * export bytes. Re-exporting from a scratch DB produces EXACTLY the Typeson
 * and rowCount manifest that the real post-restore readback will produce.
 *
 * Independently audit the staged candidate against all six shadow raw tables
 * BEFORE applying its normalized export. Any import alteration/missing row
 * fails closed without touching the user's active working database.
 */
export async function materializeAuditedM4CandidateV4(
  candidate: WorkspaceSnapshotV4,
  originalWorkspace: WorkspaceSnapshotV4,
  onStage?: (step: string, detail?: {
    kind?: string; table?: string; field?: string; row?: number
  }) => void,
): Promise<WorkspaceSnapshotV4> {
  // Never record user data or raw exception text: only a known table,
  // a syntactically sanitized FIELD NAME and an integer row ordinal.
  const stage = (step: string, detail?: {
    kind?: string; table?: string; field?: string; row?: number
  }) => {
    try { onStage?.(step, detail) } catch { /* observer is non-authoritative */ }
  }
  stage('validate')
  assertRestorableWorkspaceV4(candidate)
  assertRestorableWorkspaceV4(originalWorkspace)
  if (stableWorkspaceJson(originalWorkspace.metadata.source) !==
      stableWorkspaceJson(candidate.metadata.source)) {
    throw new Error('m4-scratch-source-account-mismatch')
  }
  const original = candidate.workspaceData.database as {
    formatName: string
    formatVersion: number
    data: {
      databaseName: string
      databaseVersion: number
      tables: Array<{ name: string; schema: string; rowCount?: number }>
      data: Array<{ tableName: string; rows: unknown[] }>
    }
  }
  const name = 'qwerty-m4-candidate-scratch-' + secureRandomUuid()
  const shadow = new Dexie(name)
  let currentStage = 'schema'
  try {
    stage(currentStage)
    shadow.version(original.data.databaseVersion).stores(
      Object.fromEntries(original.data.tables.map(entry =>
        [entry.name, entry.schema])),
    )
    // Restore the same Dexie read-side classes as RecordDB BEFORE re-export.
    // Without these maps, shadow.export() omits Typeson root "userObject"
    // markers while the live RecordDB's db.export() adds them. That made
    // byte-for-byte V4 fingerprints reject identical stored learning rows.
    applyRecordClassMappings(shadow)
    const shadowExport = { ...original,
      data: { ...original.data, databaseName: name } }
    currentStage = 'import'
    stage(currentStage)
    await shadow.import(new Blob([JSON.stringify(shadowExport)], {
      type: 'application/json',
    }), {
      acceptNameDiff: false,
      acceptVersionDiff: true,
      acceptMissingTables: false,
      acceptChangedPrimaryKey: false,
      overwriteValues: true,
      clearTablesBeforeImport: true,
    })
    currentStage = 'readback'
    stage(currentStage)
    const sourceEntries = await Promise.all(
      shadow.tables.filter(table => [
        'wordRecords', 'chapterRecords', 'reviewRecords',
        'reviewWordStates', 'achievementEvents', 'achievementStates',
      ].includes(table.name)).map(async table =>
        [table.name, await table.toCollection().raw().toArray()] as const),
    )
    const shadowRows = Object.fromEntries(sourceEntries) as
      Parameters<typeof assertV4SourceRowsMatchExport>[1]
    // The original S1 source has already passed its independent six-table
    // raw-row audit. M4 must preserve reviewRecords byte-for-byte. A nested
    // Typeson Word[] export sometimes differs from its decoded IDB shape, so
    // only this known untouched table may use a SECOND, independent source
    // check instead of the transport-only representation comparison.
    const originalReview = (originalWorkspace.workspaceData.database as typeof original)
      .data.data.find(x => x.tableName === 'reviewRecords')?.rows
    const proposedReview = original.data.data.find(x =>
      x.tableName === 'reviewRecords')?.rows
    if (!originalReview || !proposedReview ||
        stableWorkspaceJson(originalReview) !== stableWorkspaceJson(proposedReview)) {
      throw new Error('m4-scratch-review-export-was-modified')
    }

    const auditCandidateWithUnchangedReviewProof = async (
      snapshot: WorkspaceSnapshotV4,
    ): Promise<void> => {
      try {
        await assertV4SourceRowsMatchExport(snapshot, shadowRows)
      } catch (error) {
        if (!(error instanceof Error) ||
            !/^Backup V4 source\/export row-payload mismatch: reviewRecords at row \d+, different fields: words$/.test(error.message)) {
          throw error
        }
        // Never assume the Typeson encoding is harmless: verify every raw
        // ReviewRecord field against the STILL-OWNED live local RecordDB.
        // This catches word substitutions, missing sessions, undefined/NaN
        // changes, dates, sparse arrays and unknown structured-clone shapes.
        const liveReview = await db.reviewRecords.toCollection().raw().toArray()
        if (!sameLosslessIndexedDbValue(liveReview, shadowRows.reviewRecords)) {
          throw new Error('m4-scratch-review-source-readback-mismatch')
        }
        const forAudit = structuredClone(snapshot)
        const tables = (forAudit.workspaceData.database as typeof original).data.data
        const reviewGroup = tables.find(x => x.tableName === 'reviewRecords')
        if (!reviewGroup) throw new Error('m4-scratch-review-table-missing')
        reviewGroup.rows = structuredClone(shadowRows.reviewRecords)
        // The other FIVE tables still undergo their full, independent field
        // audit. Only the reviewRecords row representation is substituted,
        // and only after the real original/decoded contents match losslessly.
        await assertV4SourceRowsMatchExport(forAudit, shadowRows)
        stage('review-unchanged-verified')
      }
    }

    currentStage = 'audit-proposal'
    stage(currentStage)
    await auditCandidateWithUnchangedReviewProof(candidate)
    const canonical = structuredClone(candidate)
    currentStage = 'export'
    stage(currentStage)
    const normalizedBlob = await shadow.export()
    const normalizedDb = JSON.parse(await normalizedBlob.text()) as typeof original
    normalizedDb.data.databaseName = original.data.databaseName
    canonical.workspaceData.database = normalizedDb
    currentStage = 'audit-normalized'
    stage(currentStage)
    await auditCandidateWithUnchangedReviewProof(canonical)
    stage('validated')
    return canonical
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError'
    const message = error instanceof Error ? error.message : ''
    const mismatch = /^Backup V4 source\/export row-payload mismatch: (wordRecords|chapterRecords|reviewRecords|reviewWordStates|achievementEvents|achievementStates) at row (\d+), different fields: (.*)$/.exec(message)
    const firstField = mismatch?.[3]?.split(',')[0] ?? ''
    const normalizedField = firstField.toLowerCase().replace(/[^a-z0-9-]/g, '')
    stage(currentStage + '-failed', {
      kind: /^[A-Za-z]{1,40}$/.test(name) ? name.toLowerCase() : 'othererror',
      ...(mismatch ? {
        table: mismatch[1].toLowerCase(),
        row: Number(mismatch[2]),
        field: /^[a-z][a-z0-9-]{0,63}$/.test(normalizedField)
          ? normalizedField : 'otherfield',
      } : {
        table: message.includes('row-count mismatch') ? 'rowcount' : 'other',
      }),
    })
    throw error
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
  // The ordinary audit is intentionally based on JSON-compatible hashes.
  // It cannot prove that a negative zero survives Dexie/Typeson export.
  // Detect that source-only condition independently and always force the
  // lossless temporary-IDB roundtrip for such rows, even on fast audit PASS.
  const needsSpecialNumberAudit = sourceContainsNegativeZero(sourceRows)
  let needsFallback = needsSpecialNumberAudit
  try {
    await timed('source-rows-audit', () => assertV4SourceRowsMatchExport(snapshot, sourceRows))
  } catch (error) {
    // Only a payload mismatch can have a reversible Typeson representation.
    // A row-count mismatch, malformed archive, or damaged source still fails.
    if (!(error instanceof Error) ||
        !error.message.startsWith('Backup V4 source/export row-payload mismatch:')) {
      throw error
    }
    needsFallback = true
  }
  if (needsFallback) {
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
  restoreLearningState({ currentDict: DEFAULT_DICTIONARY_ID, currentChapter: 0 })
}
