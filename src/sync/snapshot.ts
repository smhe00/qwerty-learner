import type { LocalSnapshot } from './types'
import { db } from '@/utils/db'
import { peakImportFile } from 'dexie-export-import'

export const CLIENT_FORMAT_VERSION = 'qwerty-dexie-json-v1'

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
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

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
  const digest = await crypto.subtle.digest('SHA-256', bytes)

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

export async function createLocalSnapshot(): Promise<LocalSnapshot> {
  const blob = await db.export()
  const json = await blob.text()
  const bytes = new TextEncoder().encode(json)

  const [fingerprint, recordCount] = await Promise.all([
    fingerprintExport(json),
    localRecordCount(),
  ])

  return {
    payloadBase64: bytesToBase64(bytes),
    fingerprint,
    sizeBytes: bytes.length,
    recordCount,
    clientFormatVersion: CLIENT_FORMAT_VERSION,
  }
}

export async function restoreLocalSnapshot(
  payloadBase64: string,
  clientFormatVersion: string | null,
) {
  if (clientFormatVersion && clientFormatVersion !== CLIENT_FORMAT_VERSION) {
    throw new Error(`不支持的云端数据格式：${clientFormatVersion}`)
  }

  const bytes = base64ToBytes(payloadBase64)
  const json = new TextDecoder().decode(bytes)

  // Parse before import so malformed remote payloads never reach IndexedDB.
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

  // Backups predating DB v4 do not contain the derived review state.
  if (!hasReviewWordStates) {
    await db.reviewWordStates.clear()
  }

  const [fingerprint, recordCount] = await Promise.all([
    fingerprintExport(json),
    localRecordCount(),
  ])

  return { fingerprint, recordCount }
}
