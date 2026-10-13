import type { WorkspaceSnapshotV4 } from './workspace-v4'
import { assertRestorableWorkspaceV4 } from './workspace-v4'
import { compactTypingWordRecord, TYPING_RETENTION_PREVIEW_DAYS } from '@/utils/db/word-record-retention'
import type { IWordRecord } from '@/utils/db/record'

type ExportTable = { tableName: string; rows: unknown[] }
type ExportDb = { data: { data: ExportTable[] } }

export type V4TableSize = {
  name: string
  rows: number
  rawBytes: number
  gzipBytes: number
}
export type V4SizeAudit = {
  rawBytes: number
  gzipBytes: number
  httpBase64Bytes: number
  tables: V4TableSize[]
  oldTypingCandidates: number
  projectedGzipBytesAfterTypingCompaction: number
}

/**
 * Read-only capacity audit of an already verified FULL V4 snapshot.
 * Individual table gzip values are not additive (cross-table redundancy).
 * The projection compacts only historical Typing records, never Learn rows.
 * No local DB writes, no V4 schema change, no cloud request.
 */
export async function analyzeV4SnapshotSize(
  snapshot: WorkspaceSnapshotV4,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<V4SizeAudit> {
  assertRestorableWorkspaceV4(snapshot)
  const pako = await import('pako')
  const encoder = new TextEncoder()
  const raw = JSON.stringify(snapshot)
  const gzipBytes = pako.gzip(raw).byteLength
  const archive = JSON.parse(raw) as WorkspaceSnapshotV4
  const originalDb = snapshot.workspaceData.database as ExportDb
  const projectedDb = archive.workspaceData.database as ExportDb
  const cutoff = nowSeconds - TYPING_RETENTION_PREVIEW_DAYS * 86400
  const tables: V4TableSize[] = []
  let oldTypingCandidates = 0
  for (let i = 0; i < originalDb.data.data.length; i += 1) {
    const table = originalDb.data.data[i]
    const content = JSON.stringify(table.rows)
    tables.push({
      name: table.tableName,
      rows: table.rows.length,
      rawBytes: encoder.encode(content).byteLength,
      gzipBytes: pako.gzip(content).byteLength,
    })
    if (table.tableName !== 'wordRecords') continue
    projectedDb.data.data[i].rows = table.rows.map((value) => {
      if (!value || typeof value !== 'object') return value
      const row = value as IWordRecord
      if (row.sourceMode !== 'typing' || !Number.isFinite(row.timeStamp) ||
          row.timeStamp >= cutoff || row.learnItemKind !== undefined ||
          row.reviewRatingDecision !== undefined) return value
      const compact = compactTypingWordRecord(row)
      if (JSON.stringify(compact).length >= JSON.stringify(value).length) return value
      oldTypingCandidates += 1
      return compact
    })
  }
  tables.sort((a, b) => b.gzipBytes - a.gzipBytes)
  return {
    rawBytes: encoder.encode(raw).byteLength,
    gzipBytes,
    httpBase64Bytes: Math.ceil(gzipBytes / 3) * 4,
    tables,
    oldTypingCandidates,
    projectedGzipBytesAfterTypingCompaction:
      pako.gzip(JSON.stringify(archive)).byteLength,
  }
}
