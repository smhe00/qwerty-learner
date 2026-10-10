/**
 * P4b-0: independent source-table-count audit of a full Backup V4 export.
 * The six required tables are the only durable learning tables. Comparing
 * their exported row payloads with the live RecordDB table counts catches a
 * truncated/filtered export while the S1 writer lease is held.
 *
 * IMPORTANT: this detects export/restore omissions, not historic deletions
 * that occurred before capture. SHA-256 verifies bytes AFTER export, not
 * completeness of the original live database.
 */
import {
  REQUIRED_RESTORABLE_V4_TABLES,
  assertRestorableWorkspaceV4,
  stableWorkspaceJson,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

export type DurableV4TableName = typeof REQUIRED_RESTORABLE_V4_TABLES[number]
export type DurableV4Counts = Record<DurableV4TableName, number>

export function exportedV4TableCounts(snapshot: WorkspaceSnapshotV4): DurableV4Counts {
  assertRestorableWorkspaceV4(snapshot)
  const envelope = snapshot.workspaceData.database as {
    data: { data: Array<{ tableName: string; rows: unknown[] }> }
  }
  const counts = Object.fromEntries(
    REQUIRED_RESTORABLE_V4_TABLES.map(name => [name, 0]),
  ) as DurableV4Counts
  for (const { tableName, rows } of envelope.data.data) {
    // Validates that every table payload belongs to the full six-table
    // manifest. Other tables may exist, but may not masquerade as durable.
    if (tableName in counts) counts[tableName as DurableV4TableName] = rows.length
  }
  return counts
}

export function assertV4ExportMatchesSource(
  snapshot: WorkspaceSnapshotV4,
  source: DurableV4Counts,
): DurableV4Counts {
  const exported = exportedV4TableCounts(snapshot)
  for (const name of REQUIRED_RESTORABLE_V4_TABLES) {
    const actual = source[name]
    if (!Number.isSafeInteger(actual) || actual < 0 || actual !== exported[name]) {
      throw new Error(
        'Backup V4 source/export row-count mismatch: ' + name +
        ' source=' + String(actual) + ' exported=' + String(exported[name]),
      )
    }
  }
  return exported
}

/** Stable, independent per-table row evidence for P4b diagnostics. */
export async function v4TableRowDigests(snapshot: WorkspaceSnapshotV4):
  Promise<Record<DurableV4TableName, string>> {
  assertRestorableWorkspaceV4(snapshot)
  const envelope = snapshot.workspaceData.database as {
    data: { data: Array<{ tableName: string; rows: unknown[] }> }
  }
  const results = {} as Record<DurableV4TableName, string>
  for (const name of REQUIRED_RESTORABLE_V4_TABLES) {
    const rows = envelope.data.data.find(table => table.tableName === name)?.rows ?? []
    const canonical = stableWorkspaceJson(rows.map(row => stableWorkspaceJson(row)).sort())
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    results[name] = [...new Uint8Array(hash)]
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return results
}
