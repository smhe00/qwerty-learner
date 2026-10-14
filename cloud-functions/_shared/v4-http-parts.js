/* eslint-env node */
/**
 * P0 V4 HTTP multipart receiver. Backup V4 and revision semantics remain unchanged.
 * Staging is content addressed and account scoped. Only final commit invokes
 * the existing full V4 validation / revision conflict / write path.
 */
import crypto from 'node:crypto'
import { AppError } from './core.js'

export const V4_HTTP_PART_CHARS = 32 * 1024
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
  const { payloadSha256, index, count, data, partSha256 } = input || {}
  if (!validSha(payloadSha256) || !validSha(partSha256) ||
      !Number.isSafeInteger(index) || !Number.isSafeInteger(count) ||
      count < 1 || count > V4_HTTP_MAX_PARTS ||
      index < 0 || index >= count ||
      typeof data !== 'string' || !data.length ||
      data.length > V4_HTTP_PART_CHARS ||
      data.length % 4 !== 0 || !PART_B64.test(data) ||
      (index !== count - 1 && data.length !== V4_HTTP_PART_CHARS)) {
    invalidPart()
  }
  if (crypto.createHash('sha256').update(data, 'utf8').digest('hex') !== partSha256) {
    throw new AppError(400, 'v4_upload_part_sha_mismatch',
      'Part content does not match its immutable SHA')
  }
  if (typeof storage.putV4UploadPart !== 'function' ||
      typeof storage.getV4UploadPart !== 'function') {
    throw new AppError(503, 'v4_upload_storage_unavailable', 'V4 part storage unavailable')
  }

  const content = { version: 1, index, count, payloadSha256, partSha256, data }
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
        userId, payloadSha256, index, partSha256)
      if (JSON.stringify(observed) !== JSON.stringify(content)) {
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
  const { payloadSha256, partSha256s, count, ...metadata } = input || {}
  if (!validSha(payloadSha256) || !Array.isArray(partSha256s) ||
      !Number.isSafeInteger(count) || count < 1 || count > V4_HTTP_MAX_PARTS ||
      count !== partSha256s.length || !partSha256s.every(validSha) ||
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
          userId, payloadSha256, index, partSha256s[index])
      } catch {
        throw new AppError(503, 'v4_upload_part_not_visible',
          'Staged V4 part is not readable; retry the same manifest')
      }
    if (!record || record.version !== 1 || record.index !== index ||
        record.count !== count || record.payloadSha256 !== payloadSha256 ||
        record.partSha256 !== partSha256s[index] ||
        typeof record.data !== 'string' ||
        record.data.length > V4_HTTP_PART_CHARS ||
        record.data.length % 4 !== 0 ||
        crypto.createHash('sha256').update(record.data, 'utf8').digest('hex') !==
          record.partSha256) {
      throw new AppError(503, 'v4_upload_part_not_visible',
        'Staged V4 part is incomplete or inconsistent')
    }

      parts.push(record.data)
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
  const encoded = parts.join('')
  if (encoded.length > Math.ceil(maxSyncBytes / 3) * 4 + 4) {
    throw new AppError(413, 'request_too_large', 'Reconstructed V4 payload exceeds account quota')
  }
  const binary = Buffer.from(encoded, 'base64')
  if (binary.length > maxSyncBytes ||
      crypto.createHash('sha256').update(binary).digest('hex') !== payloadSha256) {
    throw new AppError(400, 'v4_upload_payload_sha_mismatch',
      'Uploaded parts do not reconstruct the declared V4 gzip SHA')
  }
  // The V4 service performs identity, logical fingerprint, complete six-table
  // validation, recovery preconditions, revision checks and final Blob commit.
  const canonical = {
    ...metadata, payloadBase64: encoded, clientFormatVersion: 'qwerty-backup-v4',
  }

  const commitStart = msNow()
  let result
  try {
    result = recovery
      ? await service.putSyncV4Recovery(token, canonical)
      : await service.putSyncV4(token, canonical)
  } catch (error) {
    timings.commitCoreMs = ms(commitStart)
    Object.assign(timings, storage.getLastV4RevisionTiming?.() || {})
    timings.serverTotalMs = ms(started)
    if (error instanceof AppError) {
      error.details = { failureStage: 'commit_core', timings }
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
