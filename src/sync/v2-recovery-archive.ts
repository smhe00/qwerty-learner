/**
 * P3b read-only exact-revision backup archival.
 * No RecordDB import, no mutation and no automatic format upgrade.
 * Original V4 cloud bytes are preserved so a user can roll back manually
 * even if the cloud retention policy later prunes earlier revisions.
 */
import type { RemoteSnapshot, RemoteSyncMeta } from './types'

const HASH = /^[0-9a-f]{64}$/
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024

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
  downloaded: RemoteSnapshot,
): Promise<Uint8Array> {
  if (!pinned.hasData || !downloaded.hasData ||
      !Number.isSafeInteger(pinned.revision) || pinned.revision < 1 ||
      !samePinnedRemote(pinned, downloaded) ||
      pinned.clientFormatVersion !== 'qwerty-backup-v4' ||
      !HASH.test(pinned.payloadSha256 ?? '') ||
      pinned.sizeBytes <= 0 || pinned.sizeBytes > MAX_ARCHIVE_BYTES ||
      downloaded.payloadEncoding !== 'base64' ||
      typeof downloaded.payloadBase64 !== 'string' ||
      downloaded.payloadBase64.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4 + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(downloaded.payloadBase64) ||
      downloaded.payloadBase64.length % 4 !== 0) {
    throw new Error('Cloud archive version, revision or checksum metadata changed')
  }
  const binary = atob(downloaded.payloadBase64)
  if (btoa(binary).replace(/=+$/g, '') !==
      downloaded.payloadBase64.replace(/=+$/g, '')) {
    throw new Error('Cloud archive Base64 is non-canonical')
  }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (bytes.byteLength !== pinned.sizeBytes ||
      bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('Cloud archive size/gzip signature mismatch')
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const actual = [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, '0')).join('')
  if (actual !== pinned.payloadSha256) {
    throw new Error('Cloud archive transport SHA-256 mismatch')
  }
  return bytes
}

