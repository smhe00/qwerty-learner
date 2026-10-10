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

type DurableV4SourceRows = Record<DurableV4TableName, unknown[]>

/** Dexie may return mapped Record classes with prototypes and Dates.
 * Normalize exactly as a JSON export would, rather than hashing JS identity. */
function jsonRows(rows: unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(rows)) as unknown[]
}

/**
 * A Dexie export uses Typeson to preserve IndexedDB types that JSON cannot
 * represent. In particular, a telemetry NaN is emitted as the STRING "NaN"
 * plus a path in $types, while JSON.stringify(the IDB source) emits null.
 *
 * Normalize only explicitly tagged, independently VERIFIED values against
 * the actual raw IndexedDB row. A forged tag, missing field, changed number,
 * unknown type or changed ordinary value still fails the SHA audit.
 * Do not mutate the original archive: Typeson markers must survive import.
 */
function normalizeTaggedExportRow(exported: unknown, rawSource: unknown): unknown {
  if (!exported || typeof exported !== 'object' || Array.isArray(exported) ||
      !rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
    return exported
  }
  const row = JSON.parse(JSON.stringify(exported)) as Record<string, unknown>
  const tags = row.$types
  delete row.$types
  if (tags === undefined) return row
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    // Typeson's escaped-root schema is intentionally not silently accepted.
    return exported
  }

  for (const [path, type] of Object.entries(tags)) {
    const pieces = path.split('.')
    if (pieces.some(piece => !piece || piece === '__proto__' ||
        piece === 'constructor' || piece === 'prototype')) return exported

    let expected: unknown = rawSource
    let current: unknown = row
    for (let i = 0; i < pieces.length - 1; i++) {
      if (!expected || typeof expected !== 'object' ||
          !current || typeof current !== 'object') return exported
      expected = (expected as Record<string, unknown>)[pieces[i]]
      current = (current as Record<string, unknown>)[pieces[i]]
    }
    if (!expected || typeof expected !== 'object' ||
        !current || typeof current !== 'object') return exported
    const last = pieces[pieces.length - 1]
    const origin = (expected as Record<string, unknown>)[last]
    const encoded = (current as Record<string, unknown>)[last]
    if (type === 'nan' && typeof origin === 'number' &&
        Number.isNaN(origin) && encoded === 'NaN') {
      ;(current as Record<string, unknown>)[last] = null
    } else if (type === 'infinity' && origin === Infinity &&
               encoded === 'Infinity') {
      ;(current as Record<string, unknown>)[last] = null
    } else if (type === 'negativeInfinity' && origin === -Infinity &&
               encoded === '-Infinity') {
      ;(current as Record<string, unknown>)[last] = null
    } else if (type === 'undef' && origin === undefined &&
               Object.prototype.hasOwnProperty.call(expected, last) &&
               encoded === null) {
      if (Array.isArray(current)) current[Number(last)] = null
      else delete (current as Record<string, unknown>)[last]
    } else if (type === 'sparseUndefined' && origin === undefined &&
               Array.isArray(expected) &&
               !Object.prototype.hasOwnProperty.call(expected, last) &&
               encoded === null) {
      // JSON.stringify maps both sparse holes and undefined array slots to null.
    } else if (type === 'date' && origin instanceof Date &&
               encoded === origin.getTime()) {
      ;(current as Record<string, unknown>)[last] = origin.toJSON()
    } else {
      // Unknown Typeson marker, forged metadata, or actual data change.
      return exported
    }
  }
  return row
}

/** Stable primary-key pairing prevents exporter order changes from hiding
 * per-row corruption. Table without a valid unique key fails closed. */
function byIdOrBusinessKey(rows: unknown[]): Map<string, unknown> | null {
  const result = new Map<string, unknown>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const record = row as Record<string, unknown>
    const key = record.id ?? record.eventId ?? record.achievementId
    if ((typeof key !== 'number' && typeof key !== 'string') ||
        (typeof key === 'number' && !Number.isFinite(key))) return null
    const id = String(key)
    if (result.has(id)) return null
    result.set(id, row)
  }
  return result
}

async function rowsSha256(rows: unknown[]): Promise<string> {
  const canonical = stableWorkspaceJson(
    jsonRows(rows).map(row => stableWorkspaceJson(row)).sort(),
  )
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(hash)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function assertV4SourceRowsMatchExport(
  snapshot: WorkspaceSnapshotV4,
  independentRows: DurableV4SourceRows,
): Promise<void> {
  assertV4ExportMatchesSource(snapshot,
    Object.fromEntries(REQUIRED_RESTORABLE_V4_TABLES.map(name =>
      [name, independentRows[name]?.length])) as DurableV4Counts,
  )
  for (const name of REQUIRED_RESTORABLE_V4_TABLES) {
    const exportedRows = (snapshot.workspaceData.database as {
      data: { data: Array<{tableName: string; rows: unknown[]}> }
    }).data.data.find(group => group.tableName === name)?.rows ?? []
    const sourceById = byIdOrBusinessKey(independentRows[name])
    const exportedById = byIdOrBusinessKey(exportedRows)
    const sameIds = sourceById && exportedById &&
      sourceById.size === exportedById.size &&
      [...sourceById.keys()].every(key => exportedById.has(key))
    const normalizedRows = sameIds
      ? [...sourceById.entries()].map(([id, sourceRow]) =>
        normalizeTaggedExportRow(exportedById.get(id), sourceRow))
      : exportedRows.map(row => stripDexieTransportTypes([row])[0])
    const originalHash = await rowsSha256(independentRows[name])
    const serializedHash = await rowsSha256(normalizedRows)
    if (originalHash !== serializedHash) {
      const sourceRows = jsonRows(independentRows[name])
        .map(row => stableWorkspaceJson(row)).sort()
      const exportedRows = jsonRows(normalizedRows)
        .map(row => stableWorkspaceJson(row)).sort()
      const position = sourceRows.findIndex((row, i) => row !== exportedRows[i])
      const local = JSON.parse(sourceRows[position] ?? '{}') as Record<string, unknown>
      const serialized = JSON.parse(exportedRows[position] ?? '{}') as Record<string, unknown>
      const fields = [...new Set([...Object.keys(local), ...Object.keys(serialized)])]
        .filter(key => stableWorkspaceJson(local[key] ?? null) !==
          stableWorkspaceJson(serialized[key] ?? null))
      // Diagnostic includes field NAMES only, never actual user learning rows.
      throw new Error(
        'Backup V4 source/export row-payload mismatch: ' + name +
        ' at row ' + position + ', different fields: ' + fields.join(','),
      )
    }
  }
}

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

/**
 * dexie-export-import adds a synthetic "$types" serialization descriptor
 * to exported rows. It is NOT a stored IndexedDB column. Compare actual
 * persisted row attributes, leaving other values unchanged; if a typed
 * payload was encoded differently, its corresponding field still differs
 * and the audit fails closed.
 */
function stripDexieTransportTypes(rows: unknown[]): unknown[] {
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const copy = { ...row } as Record<string, unknown>
    delete copy.$types
    return copy
  })
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
    results[name] = await rowsSha256(stripDexieTransportTypes(rows))
  }
  return results
}
