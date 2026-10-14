/* eslint-env node */
/**
 * P0 V4 HTTP multipart receiver. Backup V4 and revision semantics remain unchanged.
 * Staging is content addressed and account scoped. Only final commit invokes
 * the existing full V4 validation / revision conflict / write path.
 */
import crypto from 'node:crypto'
import { AppError } from './core.js'

export const V4_HTTP_PART_CHARS = 32 * 1024 // Legacy JSON/Base64 transport only.
export const V4_HTTP_PART_BYTES = 512 * 1024 // New octet-stream HTTP transport.
export const V4_HTTP_MAX_PARTS = 192
const SHA = /^[0-9a-f]{64}$/
const PART_B64 = /^[A-Za-z0-9+/]*={0,2}$/
const msNow = () => performance.now()
const ms = (start) => Math.round((msNow() - start) * 10) / 10

function validSha(value) {
  return typeof value === 'string' && SHA.test(value)
}
function invalidPart() {
  throw new AppError(400, 'invalid_v4_upload_part', 'Invalid bounded V4 upload part')
}

export async function receiveV4UploadPart(storage, userId, input) {
  const { payloadSha256, index, count, data, partSha256, wirePartBytes } = input || {}
  const binaryBytes = wirePartBytes
  const binary = Buffer.isBuffer(data)
  const legacy = typeof data === 'string'
  if (!validSha(payloadSha256) || !validSha(partSha256) ||
      !Number.isSafeInteger(index) || !Number.isSafeInteger(count) ||
      count < 1 || count > V4_HTTP_MAX_PARTS || index < 0 || index >= count ||
      (!binary && !legacy) ||
      (legacy && (!data.length || data.length > V4_HTTP_PART_CHARS ||
        data.length % 4 !== 0 || !PART_B64.test(data) ||
        (index !== count - 1 && data.length !== V4_HTTP_PART_CHARS))) ||
      (binary && (binaryBytes !== V4_HTTP_PART_BYTES ||
        !data.length || data.length > binaryBytes ||
        (index !== count - 1 && data.length !== binaryBytes)))) {
    invalidPart()
  }
  if (crypto.createHash('sha256').update(data, legacy ? 'utf8' : undefined)
    .digest('hex') !== partSha256) {
    throw new AppError(400, 'v4_upload_part_sha_mismatch',
      'Part content does not match its immutable SHA')
  }
  if (typeof storage.putV4UploadPart !== 'function' ||
      typeof storage.getV4UploadPart !== 'function') {
    throw new AppError(503, 'v4_upload_storage_unavailable', 'V4 part storage unavailable')
  }

  // Binary v3 stages raw bytes in Blob directly. Legacy JSON Base64 v1
  // remains readable for older deployed tabs, without re-encoding new parts.
  const content = { version: binary ? 3 : 1, index, count, payloadSha256,
    partSha256, data, ...(binary ? { wirePartBytes } : {}) }
  const started = msNow()
  const timings = {}
  let failureStage = 'blob_write'
  try {
    const writeStart = msNow()
    try {
      const saved = await storage.putV4UploadPart(
        userId, payloadSha256, index, partSha256, content)
      if (!saved) throw new Error('Staged V4 part key contains different evidence')
    } finally {
      timings.blobWriteMs = ms(writeStart)
    }
    failureStage = 'blob_readback'
    const readStart = msNow()
    try {
      const observed = await storage.getV4UploadPart(
        userId, payloadSha256, index, partSha256, count, wirePartBytes)
      // Native 512-KiB Blob bodies are verified byte-wise. JSON.stringify
      // on Buffer expands binary into millions of decimal characters and
      // needlessly increases Maker CPU/memory pressure.
      const matches = binary
        ? observed?.version === 3 &&
          observed.index === content.index && observed.count === content.count &&
          observed.wirePartBytes === V4_HTTP_PART_BYTES &&
          observed.payloadSha256 === content.payloadSha256 &&
          observed.partSha256 === content.partSha256 &&
          Buffer.isBuffer(observed.data) && observed.data.equals(data)
        : JSON.stringify(observed) === JSON.stringify(content)
      if (!matches) {
        throw new Error('V4 upload part readback mismatch')
      }
    } finally {
      timings.blobReadbackMs = ms(readStart)
    }
  } catch {
    timings.serverTotalMs = ms(started)
    // Fixed stage codes only. Never disclose storage keys, account IDs or payloads.
    throw new AppError(503, 'v4_upload_part_unverified',
      'V4 part write cannot be verified; retry the identical part',
      { failureStage, timings })
  }
  timings.serverTotalMs = ms(started)
  return { received: true, payloadSha256, partSha256, index, timings }
}

export async function commitV4Upload(storage, service, token, userId, input, maxSyncBytes,
  recovery = false) {
  const { payloadSha256, partSha256s, count, wirePartBytes, ...metadata } = input || {}
  const binaryBytes = wirePartBytes === undefined ? V4_HTTP_PART_BYTES : wirePartBytes
  if (!validSha(payloadSha256) || !Array.isArray(partSha256s) ||
      !Number.isSafeInteger(count) || count < 1 || count > V4_HTTP_MAX_PARTS ||
      count !== partSha256s.length || !partSha256s.every(validSha) ||
      binaryBytes !== V4_HTTP_PART_BYTES ||
      !Number.isSafeInteger(maxSyncBytes) || maxSyncBytes < 1) {
    throw new AppError(400, 'invalid_v4_upload_manifest',
      'Invalid V4 upload manifest or part hashes')
  }
  if (typeof storage.getV4UploadPart !== 'function') {
    throw new AppError(503, 'v4_upload_storage_unavailable', 'V4 part storage unavailable')
  }

  const started = msNow()
  const timings = {}
  const parts = []
  const readStart = msNow()
  try {
    for (let index = 0; index < count; index++) {
      let record
      try {
        record = await storage.getV4UploadPart(
          userId, payloadSha256, index, partSha256s[index], count, wirePartBytes)
      } catch {
        throw new AppError(503, 'v4_upload_part_not_visible',
          'Staged V4 part is not readable; retry the same manifest')
      }
      if (!record || ![1, 2, 3].includes(record.version) ||
          record.index !== index || record.count !== count ||
          record.payloadSha256 !== payloadSha256 ||
          record.partSha256 !== partSha256s[index] ||
          (record.version === 3 &&
           record.wirePartBytes !== binaryBytes)) {
        throw new AppError(503, 'v4_upload_part_not_visible',
          'Staged V4 part is incomplete or inconsistent')
      }
      if (index > 0 && record.version !== parts[0].version) {
        throw new AppError(400, 'v4_upload_mixed_transport',
          'V4 multipart manifest mixes incompatible wire protocols')
      }
      let decoded
      if (record.version === 3) {
        if (!Buffer.isBuffer(record.data) || !record.data.length ||
            record.data.length > binaryBytes ||
            (index !== count - 1 && record.data.length !== binaryBytes)) {
          throw new AppError(503, 'v4_upload_part_not_visible',
            'Binary V4 part size or format invalid')
        }
        decoded = record.data
      } else {
        if (typeof record.data !== 'string' || !PART_B64.test(record.data) ||
            record.data.length % 4 !== 0 ||
            (record.version === 1 &&
              (!record.data.length || record.data.length > V4_HTTP_PART_CHARS ||
               (index !== count - 1 && record.data.length !== V4_HTTP_PART_CHARS))) ||
            (record.version === 2 && (record.data.length < 4 ||
               record.data.length > Math.ceil(V4_HTTP_PART_BYTES / 3) * 4))) {
          throw new AppError(503, 'v4_upload_part_not_visible',
            'Legacy part size or encoding invalid')
        }
        decoded = record.version === 2 ? Buffer.from(record.data, 'base64') : null
        if (record.version === 2 && (!decoded.length ||
            decoded.length > V4_HTTP_PART_BYTES ||
            (index !== count - 1 && decoded.length !== V4_HTTP_PART_BYTES) ||
            decoded.toString('base64') !== record.data)) {
          throw new AppError(503, 'v4_upload_part_not_visible',
            'Legacy binary staging failed integrity check')
        }
      }
      const hash = crypto.createHash('sha256')
        .update(record.version === 1 ? record.data : decoded).digest('hex')
      if (hash !== record.partSha256) {
        throw new AppError(503, 'v4_upload_part_not_visible',
          'V4 upload part SHA mismatch')
      }
      parts.push({ version: record.version, data: record.version === 1
        ? record.data : decoded })
      if (parts.reduce((total, part) => total +
        (part.version === 1 ? part.data.length * 3 / 4 : part.data.length), 0)
        > maxSyncBytes + 2) {
        throw new AppError(413, 'request_too_large', 'V4 staged upload exceeds account quota')
      }
    }
  } catch (error) {
    timings.partsReadMs = ms(readStart)
    timings.serverTotalMs = ms(started)
    if (error instanceof AppError) {
      error.details = { failureStage: 'part_lookup', timings }
    }
    throw error
  }
  timings.partsReadMs = ms(readStart)
  const binary = parts[0].version !== 1
    ? Buffer.concat(parts.map(part => part.data))
    : Buffer.from(parts.map(part => part.data).join(''), 'base64')
  if (binary.length > maxSyncBytes ||
      crypto.createHash('sha256').update(binary).digest('hex') !== payloadSha256) {
    throw new AppError(400, 'v4_upload_payload_sha_mismatch',
      'Uploaded parts do not reconstruct the declared V4 gzip SHA')
  }
  // V4 service owns identity, six-table validation, fingerprint, CAS and
  // recovery. New binary snapshots are NEVER Base64-encoded at commit.
  const canonical = { ...metadata, payloadBytes: binary,
    clientFormatVersion: 'qwerty-backup-v4' }

  const commitStart = msNow()
  let result
  try {
    result = recovery
      ? await service.putSyncV4BinaryRecovery(token, canonical)
      : await service.putSyncV4Binary(token, canonical)
  } catch (error) {
    timings.commitCoreMs = ms(commitStart)
    Object.assign(timings, storage.getLastV4RevisionTiming?.() || {})
    timings.serverTotalMs = ms(started)
    if (error instanceof AppError) {
      const blobStage = error.code === 'snapshot_blob_stage_failed'
        ? error.details?.stage : null
      const failureStage = blobStage === 'chunk_precommit' ? 'revision_chunk'
        : blobStage === 'manifest_commit' ? 'revision_manifest' : 'commit_core'
      const partIndex = Number.isSafeInteger(error.details?.partIndex) &&
        error.details.partIndex >= 0 && error.details.partIndex < 192
        ? error.details.partIndex : undefined
      // Preserve the V4 CAS conflict's current revision/SHA evidence.
      // Diagnostics must NEVER change the recovery contract.
      const existing = error.details && typeof error.details === 'object'
        ? error.details : {}
      error.details = { ...existing, failureStage, partIndex, timings }
    }
    // The outcome of a failed commit can be ambiguous. Never retry it here.
    throw error
  }
  timings.commitCoreMs = ms(commitStart)
  Object.assign(timings, storage.getLastV4RevisionTiming?.() || {})
  // Cleanup is maintenance only, AFTER durable revision commit.
  const cleanupStart = msNow()
  try {
    await storage.deleteV4UploadParts?.(userId, payloadSha256)
  } catch {
    // Lost cleanup response never changes published revision semantics.
  }
  timings.cleanupMs = ms(cleanupStart)
  timings.serverTotalMs = ms(started)
  return { ...result, timings }
}
