/**
 * Manual Backup V4 application-test entry points.
 * Explicitly independent of Cloud Sync V1/V3 and destructive V4 restore.
 * Import/restore is deliberately NOT enabled before S1 boot recovery and
 * tab-wide writer fencing are integrated.
 */
import {
  DURABLE_BACKUP_TABLE_NAMES,
} from '@/utils/backup'
import { getCurrentDate, recordDataAction } from '@/utils'
import { db } from '@/utils/db/core'
import { loadAuth } from './auth'
import { captureWorkingWorkspaceV4 } from './workspace-v4-browser'
import {
  parseWorkspaceV4,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

export type ManualV4Inspection = {
  format: 'qwerty-backup-v4'
  owner: string
  tableCount: number
  dailySessions: number
  settingCount: number
  fingerprint: string
}

export function validateManualBackupV4(json: string): WorkspaceSnapshotV4 {
  const snapshot = parseWorkspaceV4(json)
  // V4 is a complete workspace replacement, unlike historical V3 imports:
  // reject incomplete or counterfeit Dexie table manifests BEFORE restore.
  const database = snapshot.workspaceData.database as {
    formatName?: unknown
    data?: { tables?: Array<{ name?: string }> }
  }
  if (database.formatName !== 'dexie' || !Array.isArray(database.data?.tables)) {
    throw new Error('V4 数据库结构不是有效的 Dexie 导出文件。')
  }
  const available = new Set(database.data.tables.map(table => table.name))
  const missing = DURABLE_BACKUP_TABLE_NAMES.filter(name => !available.has(name))
  if (missing.length) {
    throw new Error('V4 数据库缺少必要表：' + missing.join(', '))
  }
  return snapshot
}

export async function inspectManualBackupV4(json: string): Promise<ManualV4Inspection> {
  const snapshot = validateManualBackupV4(json)
  return {
    format: snapshot.backupFormatVersion,
    owner: snapshot.metadata.source.kind === 'account'
      ? '账号（ID：' + snapshot.metadata.source.accountId + '）'
      : '匿名工作区',
    tableCount: DURABLE_BACKUP_TABLE_NAMES.length,
    dailySessions: Object.keys(snapshot.workspaceData.learnRuntime.dailySessions).length,
    settingCount: Object.keys(snapshot.workspaceData.settings.values).length,
    fingerprint: await workspaceFingerprintV4(snapshot),
  }
}

export async function exportManualBackupV4Json(): Promise<string> {
  const auth = loadAuth()
  const source = auth
    ? { kind: 'account' as const, accountId: auth.user.userId }
    : { kind: 'anonymous' as const }
  const snapshot = await captureWorkingWorkspaceV4(source)
  const json = JSON.stringify(snapshot)
  validateManualBackupV4(json)
  return json
}

export async function downloadManualBackupV4(): Promise<ManualV4Inspection> {
  const json = await exportManualBackupV4Json()
  const summary = await inspectManualBackupV4(json)
  const [pako, { saveAs }] = await Promise.all([
    import('pako'), import('file-saver'),
  ])
  const compressed = pako.gzip(json)
  const blob = new Blob([compressed], { type: 'application/gzip' })
  const [wordCount, chapterCount] = await Promise.all([
    db.wordRecords.count(), db.chapterRecords.count(),
  ])
  saveAs(blob, `Qwerty-Plus-Backup-V4-${getCurrentDate()}.gz`)
  recordDataAction({ type: 'export', size: blob.size, wordCount, chapterCount })
  return summary
}

export async function inspectManualBackupV4File(file: File): Promise<ManualV4Inspection> {
  if (file.size > 128 * 1024 * 1024) {
    throw new Error('备份文件过大，请检查是否选择了正确的文件。')
  }
  const pako = await import('pako')
  let json: string
  try {
    json = pako.ungzip(await file.arrayBuffer(), { to: 'string' })
  } catch {
    throw new Error('文件不是有效的 gzip 备份。')
  }
  return inspectManualBackupV4(json)
}
