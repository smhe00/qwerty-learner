/**
 * P3b read-only exact-revision backup archival.
 * No RecordDB import, no mutation and no automatic format upgrade.
 * Original V4 cloud bytes are preserved so a user can roll back manually
 * even if the cloud retention policy later prunes earlier revisions.
 */
import type { RemoteBinarySnapshot, RemoteSnapshot, RemoteSyncMeta } from './types'
import { sha256Hex } from './sha256-compat'

const HASH = /^[0-9a-f]{64}$/
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024

export function samePinnedRemote(
  a: RemoteSyncMeta,
  b: RemoteSyncMeta,
): boolean {
  return a.hasData === b.hasData &&
    a.revision === b.revision &&
    a.clientFormatVersion === b.clientFormatVersion &&
    a.payloadSha256 === b.payloadSha256 &&
    a.logicalFingerprint === b.logicalFingerprint &&
    a.sizeBytes === b.sizeBytes
}

export async function verifyPinnedCloudArchive(
  pinned: RemoteSyncMeta,
  downloaded: RemoteSnapshot | RemoteBinarySnapshot,
): Promise<Uint8Array> {
  if (!pinned.hasData || !downloaded.hasData ||
      !Number.isSafeInteger(pinned.revision) || pinned.revision < 1 ||
      !samePinnedRemote(pinned, downloaded) ||
      pinned.clientFormatVersion !== 'qwerty-backup-v4' ||
      !HASH.test(pinned.payloadSha256 ?? '') ||
      pinned.sizeBytes <= 0 || pinned.sizeBytes > MAX_ARCHIVE_BYTES ||
      !['binary', 'base64'].includes(downloaded.payloadEncoding)) {
    throw new Error('Cloud archive version, revision or checksum metadata changed')
  }
  let bytes: Uint8Array
  if (downloaded.payloadEncoding === 'binary') {
    bytes = downloaded.payloadBytes
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('Cloud binary archive payload not available')
    }
  } else {
    if (typeof downloaded.payloadBase64 !== 'string' ||
        downloaded.payloadBase64.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4 + 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(downloaded.payloadBase64) ||
        downloaded.payloadBase64.length % 4 !== 0) {
      throw new Error('Invalid historical Base64 archive')
    }
    const binary = atob(downloaded.payloadBase64)
    if (btoa(binary).replace(/=+$/g, '') !==
        downloaded.payloadBase64.replace(/=+$/g, '')) {
      throw new Error('Historical archive Base64 is non-canonical')
    }
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  }
  if (bytes.byteLength !== pinned.sizeBytes ||
      bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('Cloud archive size/gzip signature mismatch')
  }
  const actual = await sha256Hex(bytes)
  if (actual !== pinned.payloadSha256) {
    throw new Error('Cloud archive transport SHA-256 mismatch')
  }
  return bytes
}

