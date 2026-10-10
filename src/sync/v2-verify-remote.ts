/**
 * S2 read-only cloud snapshot verification. NO IndexedDB, localStorage,
 * V4 import, baseline update or automatic conflict resolution.
 *
 * The caller must pin a GET snapshot to a previously inspected revision and
 * verify BOTH transport SHA-256 and canonical workspace SHA-256 before the
 * crash-journaled pull executor may restore anything.
 */
import { parseWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { RemoteSnapshot, RemoteSyncMeta } from './types'

const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024
const MAX_INFLATED_BYTES = 32 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(result)]
    .map(value => value.toString(16).padStart(2, '0')).join('')
}

function decodeBase64(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      encoded.length % 4 !== 0 ||
      encoded.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4 + 4) {
    throw new Error('V4 payload Base64 is invalid or exceeds the upload limit')
  }
  const binary = atob(encoded)
  if (btoa(binary).replace(/=+$/g, '') !== encoded.replace(/=+$/g, '')) {
    throw new Error('V4 payload Base64 is non-canonical')
  }
  const result = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i)
  if (result.byteLength > MAX_COMPRESSED_BYTES) throw new Error('V4 compressed snapshot too large')
  return result
}

async function boundedInflate(payload: Uint8Array): Promise<string> {
  // Streams allow an upper bound BEFORE materializing the full decompressed
  // content; unlike a single-buffer gzip call, they reject zip bombs early.
  const input = new Blob([payload]).stream()
  const output = input.pipeThrough(new DecompressionStream('gzip'))
  const reader = output.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_INFLATED_BYTES) {
        await reader.cancel('V4 inflated payload exceeds maximum')
        throw new Error('V4 inflated snapshot exceeds maximum size')
      }
      parts.push(value)
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('V4 gzip stream is invalid')
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { merged.set(part, offset); offset += part.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged)
}

export async function verifyDownloadedWorkspaceV4(
  expectedOwnerId: string,
  observedMeta: RemoteSyncMeta,
  remote: RemoteSnapshot,
): Promise<WorkspaceSnapshotV4> {
  if (!expectedOwnerId || !expectedOwnerId.trim()) throw new Error('Missing V4 account owner')
  if (!observedMeta.hasData || !remote.hasData ||
      !Number.isSafeInteger(observedMeta.revision) ||
      remote.revision !== observedMeta.revision ||
      remote.clientFormatVersion !== 'qwerty-backup-v4' ||
      observedMeta.clientFormatVersion !== 'qwerty-backup-v4' ||
      !SHA256.test(observedMeta.logicalFingerprint || '') ||
      remote.logicalFingerprint !== observedMeta.logicalFingerprint ||
      !SHA256.test(observedMeta.payloadSha256 || '') ||
      remote.payloadSha256 !== observedMeta.payloadSha256 ||
      remote.payloadEncoding !== 'base64' ||
      !remote.payloadBase64) {
    throw new Error('V4 cloud metadata changed, is incomplete, or format unsupported')
  }
  const compressed = decodeBase64(remote.payloadBase64)
  if (compressed.byteLength !== remote.sizeBytes ||
      compressed.byteLength !== observedMeta.sizeBytes ||
      await digest(compressed) !== observedMeta.payloadSha256) {
    throw new Error('V4 cloud compressed payload checksum or size mismatch')
  }
  const json = await boundedInflate(compressed)
  const snapshot = parseWorkspaceV4(json)
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== expectedOwnerId) {
    throw new Error('V4 downloaded snapshot owner mismatch')
  }
  if (await workspaceFingerprintV4(snapshot) !== remote.logicalFingerprint) {
    throw new Error('V4 downloaded canonical fingerprint mismatch')
  }
  return snapshot
}
