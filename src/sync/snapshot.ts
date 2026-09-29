import type { LocalSnapshot, LocalState } from './types'
import { db } from '@/utils/db'
import { peakImportFile } from 'dexie-export-import'

export const CLIENT_FORMAT_VERSION = 'qwerty-dexie-gzip-v2'

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

function logicalExportData(json: string) {
  const parsed = JSON.parse(json) as { data?: unknown }
  return parsed.data ?? parsed
}

async function fingerprintExport(json: string) {
  return sha256Hex(stableStringify(logicalExportData(json)))
}

async function localRecordCount() {
  const counts = await Promise.all([
    db.wordRecords.count(),
    db.chapterRecords.count(),
    db.reviewRecords.count(),
    db.reviewWordStates.count(),
  ])

  return counts.reduce((sum, value) => sum + value, 0)
}

async function exportLocalJson() {
  const blob = await db.export()
  return blob.text()
}

async function stateFromJson(json: string): Promise<LocalState> {
  const [fingerprint, recordCount] = await Promise.all([
    fingerprintExport(json),
    localRecordCount(),
  ])

  return {
    fingerprint,
    sizeBytes: new TextEncoder().encode(json).length,
    recordCount,
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
  if (clientFormatVersion !== CLIENT_FORMAT_VERSION) {
    throw new Error('云端数据格式已过期或不受支持，请使用当前本地数据重新上传。')
  }

  const compressed = base64ToBytes(payloadBase64)
  const pako = await import('pako')

  try {
    return pako.ungzip(compressed, { to: 'string' })
  } catch {
    throw new Error('云端压缩数据已损坏，无法恢复。')
  }
}

export async function restoreLocalSnapshot(
  payloadBase64: string,
  clientFormatVersion: string | null,
) {
  const json = await decodeSnapshotJson(payloadBase64, clientFormatVersion)

  // Validate JSON and Dexie metadata before touching IndexedDB.
  JSON.parse(json)

  const blob = new Blob([json], { type: 'application/json' })
  const importMeta = await peakImportFile(blob)
  const hasReviewWordStates = importMeta.data.tables.some(
    (table) => table.name === 'reviewWordStates',
  )

  await db.import(blob, {
    acceptVersionDiff: true,
    acceptMissingTables: true,
    acceptNameDiff: false,
    acceptChangedPrimaryKey: false,
    overwriteValues: true,
    clearTablesBeforeImport: true,
  })

  if (!hasReviewWordStates) {
    await db.reviewWordStates.clear()
  }

  return stateFromJson(json)
}
