import type { LocalSnapshot, LocalState } from './types'
import {
  BACKUP_FORMAT_VERSION,
  exportBackupJson,
  importBackupJson,
  isSupportedBackupFormat,
  readLearningState,
} from '@/utils/backup'
import { db } from '@/utils/db/core'

export const CLIENT_FORMAT_VERSION = BACKUP_FORMAT_VERSION

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function logicalBackupData(json: string) {
  const parsed = JSON.parse(json) as {
    backupFormatVersion?: string
    learningState?: unknown
    database?: { data?: unknown } | unknown
    data?: unknown
  }

  if (parsed.backupFormatVersion === BACKUP_FORMAT_VERSION && parsed.database) {
    const database = parsed.database as { data?: unknown }
    return {
      learningState: parsed.learningState ?? null,
      database: database.data ?? database,
    }
  }

  return parsed.data ?? parsed
}

async function fingerprintExport(json: string) {
  return sha256Hex(stableStringify(logicalBackupData(json)))
}

/**
 * Sync-side user intent projection. V3 exports contain both durable learning
 * evidence and derivable scheduler/session scaffolding. Learn preparation may
 * rebuild the latter without a single accepted keystroke. Only treat the
 * former, explicit exclusion and V3 navigation changes as user changes.
 *
 * Hash from the EXACT exported JSON, not a second live DB read: otherwise
 * snapshot and provenance could observe different concurrent transactions.
 */
async function fingerprintUserActions(json: string): Promise<string> {
  const envelope = JSON.parse(json) as {
    learningState?: unknown
    database?: {
      data?: { data?: Array<{ tableName?: string; rows?: unknown[] }> }
    }
  }
  const tables = envelope.database?.data?.data
  if (!Array.isArray(tables)) {
    // Unknown export structure is not safe to label "derived-only".
    // Keep the strict physical fingerprint as the evidence fallback.
    return fingerprintExport(json)
  }
  const rows = (name: string): unknown[] =>
    tables.find((entry) => entry.tableName === name)?.rows ?? []
  const sorted = (items: unknown[]) =>
    items.map((item) => stableStringify(item)).sort()

  const excludedStates = rows('reviewWordStates').filter((item) =>
    typeof item === 'object' && item !== null &&
    (item as { lifecycle?: string }).lifecycle === 'excluded',
  )
  const activeProgress = rows('reviewRecords').filter((item) => {
    if (typeof item !== 'object' || item === null) return false
    const record = item as {
      index?: number
      isFinished?: boolean
      hintStates?: Record<string, unknown>
    }
    return Boolean(
      (record.index ?? 0) > 0 ||
      record.isFinished ||
      (record.hintStates && Object.keys(record.hintStates).length > 0),
    )
  })
  return sha256Hex(stableStringify({
    navigation: envelope.learningState ?? null,
    wordRecords: sorted(rows('wordRecords')),
    chapterRecords: sorted(rows('chapterRecords')),
    excludedStates: sorted(excludedStates),
    activeProgress: sorted(activeProgress),
  }))
}

async function localRecordCount() {
  const counts = await Promise.all([
    db.wordRecords.count(),
    db.chapterRecords.count(),
    db.reviewRecords.count(),
    db.reviewWordStates.count(),
    db.achievementEvents.count(),
    db.achievementStates.count(),
  ])

  return counts.reduce((sum, value) => sum + value, 0)
}

async function exportLocalJson() {
  return exportBackupJson()
}

async function stateFromJson(json: string): Promise<LocalState> {
  const [fingerprint, userActionFingerprint, recordCount] = await Promise.all([
    fingerprintExport(json),
    fingerprintUserActions(json),
    localRecordCount(),
  ])
  const learningState = readLearningState()
  const hasMeaningfulState =
    recordCount > 0 ||
    learningState.currentDict !== 'zhongkaohexin' ||
    learningState.currentChapter !== 0

  return {
    fingerprint,
    userActionFingerprint,
    sizeBytes: new TextEncoder().encode(json).length,
    recordCount,
    hasMeaningfulState,
  }
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function base64ToBytes(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('云端数据的 Base64 格式无效。')
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  if (bytesToBase64(bytes).replace(/=+$/g, '') !== value.replace(/=+$/g, '')) {
    throw new Error('云端数据的 Base64 编码不规范。')
  }

  return bytes
}

export { isSupportedBackupFormat as isSupportedSnapshotFormat }

export async function inspectLocalState(): Promise<LocalState> {
  const json = await exportLocalJson()
  return stateFromJson(json)
}

export async function createLocalSnapshot(): Promise<LocalSnapshot> {
  const json = await exportLocalJson()
  const local = await stateFromJson(json)
  const pako = await import('pako')
  const compressed = pako.gzip(json)

  return {
    ...local,
    payloadBase64: bytesToBase64(compressed),
    clientFormatVersion: CLIENT_FORMAT_VERSION,
  }
}

async function decodeSnapshotJson(
  payloadBase64: string,
  clientFormatVersion: string | null,
) {
  if (!isSupportedBackupFormat(clientFormatVersion)) {
    throw new Error('云端数据格式不受支持，请使用当前本地数据重新上传。')
  }

  const compressed = base64ToBytes(payloadBase64)
  const pako = await import('pako')

  try {
    return pako.ungzip(compressed, { to: 'string' })
  } catch {
    throw new Error('云端压缩数据已损坏，无法恢复。')
  }
}

/**
 * Read-only provenance check for old cloud baselines. The caller must verify
 * the remote revision has not changed before binding the comparison to an
 * account. It never imports or changes local learning records.
 */
export async function fingerprintRemoteUserActions(
  payloadBase64: string,
  clientFormatVersion: string | null,
): Promise<string> {
  const json = await decodeSnapshotJson(payloadBase64, clientFormatVersion)
  return fingerprintUserActions(json)
}

export async function restoreLocalSnapshot(
  payloadBase64: string,
  clientFormatVersion: string | null,
) {
  const json = await decodeSnapshotJson(payloadBase64, clientFormatVersion)
  const imported = await importBackupJson(json, { clientFormatVersion })
  const local = await inspectLocalState()

  return {
    ...local,
    restoredLearningState: imported.restoredLearningState,
    hasLearningState: imported.hasLearningState,
  }
}
