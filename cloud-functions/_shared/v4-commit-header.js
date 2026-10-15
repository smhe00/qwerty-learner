/* eslint-env node */
/**
 * Native V4 multipart commit metadata uses a bodyless POST. EdgeOne Makers
 * intermittently fails consuming even tiny request bodies; immutable staged
 * parts already carry the binary payload. Existing JSON commits remain valid
 * for older clients and explicit recovery.
 *
 * Never accept the header protocol on a recovery route: recovery requires
 * separately confirmed, pinned user intent in the JSON body.
 */
import { AppError } from './core.js'

const SHA = /^[a-f0-9]{64}$/
const UINT = /^(0|[1-9][0-9]*)$/
const HEADER_PROTOCOL = 'header-v1'
const MAX_PARTS = 192
const CHUNK_BYTES = 512 * 1024
const LIMIT = 16 * 1024 * 1024

const invalid = () => {
  throw new AppError(400, 'invalid_v4_commit_headers',
    'Invalid bounded V4 header-only commit metadata')
}

export function hasV4CommitHeaders(request) {
  return request.headers.get('x-qwerty-commit-protocol') !== null
}

export function readV4CommitHeaders(request) {
  const headers = request.headers
  if (headers.get('x-qwerty-commit-protocol') !== HEADER_PROTOCOL ||
      (request.body !== null && request.body !== undefined)) invalid()
  const contentLength = headers.get('content-length')
  if (contentLength !== null && contentLength !== '0') invalid()
  const type = headers.get('content-type')
  if (type && type !== 'application/octet-stream' && type !== 'application/json') invalid()

  const field = key => headers.get('x-qwerty-' + key)
  const rawBase = field('base-revision')
  const rawCount = field('part-count')
  const rawSha = field('payload-sha256')
  const rawLogical = field('logical-fingerprint')
  const rawParts = field('part-sha256s')
  const wire = field('chunk-bytes')
  if (!UINT.test(rawBase || '') || !UINT.test(rawCount || '') ||
      !SHA.test(rawSha || '') || !SHA.test(rawLogical || '') ||
      wire !== String(CHUNK_BYTES) || typeof rawParts !== 'string' ||
      rawParts.length > 65 * MAX_PARTS) invalid()
  const baseRevision = Number(rawBase)
  const count = Number(rawCount)
  const partSha256s = rawParts.split(',')
  if (!Number.isSafeInteger(baseRevision) || !Number.isSafeInteger(count) ||
      count < 2 || count > MAX_PARTS || count > Math.ceil(LIMIT / CHUNK_BYTES) ||
      partSha256s.length !== count || !partSha256s.every(s => SHA.test(s))) invalid()
  const deviceId = field('device-id')
  if (deviceId !== null && (deviceId.length < 1 || deviceId.length > 128 ||
      /[\x00-\x1f\x7f]/.test(deviceId))) invalid()
  return { baseRevision, count, payloadSha256: rawSha,
    partSha256s, logicalFingerprint: rawLogical,
    wirePartBytes: CHUNK_BYTES,
    clientFormatVersion: 'qwerty-backup-v4',
    ...(deviceId === null ? {} : { deviceId }) }
}
