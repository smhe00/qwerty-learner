import {
  ENCRYPTED_CLIENT_FORMAT_VERSION,
  LEGACY_CLIENT_FORMAT_VERSION,
  decodeTransportPayload,
  decryptCompressedSnapshot,
  encodeTransportPayload,
  encryptCompressedSnapshot,
} from './crypto'
import type { LocalSnapshot, LocalState } from './types'
import { db } from '@/utils/db'
import { peakImportFile } from 'dexie-export-import'

export const CLIENT_FORMAT_VERSION = ENCRYPTED_CLIENT_FORMAT_VERSION

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

export async function inspectLocalState(): Promise<LocalState> {
  const json = await exportLocalJson()
  return stateFromJson(json)
}

export async function createLocalSnapshot(
  passphrase: string,
  userId: string,
): Promise<LocalSnapshot> {
  const json = await exportLocalJson()
  const local = await stateFromJson(json)
  const pako = await import('pako')
  const compressed = pako.gzip(json)
  const envelopeBytes = await encryptCompressedSnapshot(compressed, passphrase, userId)

  return {
    ...local,
    payloadBase64: encodeTransportPayload(envelopeBytes),
    clientFormatVersion: ENCRYPTED_CLIENT_FORMAT_VERSION,
  }
}

async function decodeSnapshotJson(
  payloadBase64: string,
  clientFormatVersion: string | null,
  passphrase: string,
  userId: string,
) {
  const payloadBytes = decodeTransportPayload(payloadBase64)

  if (
    clientFormatVersion === null ||
    clientFormatVersion === LEGACY_CLIENT_FORMAT_VERSION
  ) {
    return new TextDecoder().decode(payloadBytes)
  }

  if (clientFormatVersion !== ENCRYPTED_CLIENT_FORMAT_VERSION) {
    throw new Error(`不支持的云端数据格式：${clientFormatVersion}`)
  }

  const compressed = await decryptCompressedSnapshot(payloadBytes, passphrase, userId)
  const pako = await import('pako')
  return pako.ungzip(compressed, { to: 'string' })
}

export async function restoreLocalSnapshot(
  payloadBase64: string,
  clientFormatVersion: string | null,
  passphrase: string,
  userId: string,
) {
  const json = await decodeSnapshotJson(
    payloadBase64,
    clientFormatVersion,
    passphrase,
    userId,
  )

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
