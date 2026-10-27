/* eslint-env node */
import crypto from 'node:crypto'
import { AppError } from './core.js'
import { withRetry } from './storage/edgeone-blob.js'

const OP = /^[a-f0-9]{32}$/
const USER = /^[a-f0-9]{32}$/
const HASH = /^[a-f0-9]{64}$/
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
const TTL = 24 * 60 * 60 * 1000
// Fixed provider classifications only; never expose messages, Blob keys or tokens.
const ERROR_NAMES = ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'PagesBlobError']
const ERROR_CODES = ['CREDENTIAL_ERROR', 'COS_ERROR', 'RATE_LIMITED', 'QUOTA_EXCEEDED',
  'PRECONDITION_FAILED', 'MISSING_ENVIRONMENT', 'MISSING_PROJECT_ID', 'INVALID_KEY',
  'INVALID_STORE_NAME', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
  'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']
function classify(error) {
  const code = error?.code ?? error?.cause?.code
  return { errorName: ERROR_NAMES.includes(error?.name) ? error.name : 'UnknownError',
    errorCode: ERROR_CODES.includes(code) ? code : 'unknown' }
}
const elapsed = start => Math.max(0, Date.now() - start)

// Read-only recovery capability: both the original bearer AND a random operation
// ID are required. Account/session erasure must not erase its own acknowledgement.
// This is not a deletion retry/resume endpoint or a Blob-CAS concurrency claim.
export function createAccountDeletionReceipts({ store, now = Date.now }) {
  const read = key => withRetry(() => store.get(key, { type: 'json', consistency: 'strong' }))
  function prefix(token, operationId) {
    if (!OP.test(operationId || '') || typeof token !== 'string' || token.length < 32 || token.length > 1024)
      throw new AppError(400, 'invalid_deletion_operation', 'Invalid deletion operation')
    return 'maintenance/account-deletion/v1/' + hash(token) + '/' + operationId + '/'
  }
  async function saveOnce(key, record, phase) {
    const writeStarted = Date.now()
    let write
    try {
      await store.setJSON(key, record, { onlyIfNew: true })
      write = { status: 'acknowledged', elapsedMs: elapsed(writeStarted) }
    } catch (error) {
      write = { status: 'error', elapsedMs: elapsed(writeStarted), ...classify(error) }
    }
    // Still exactly one application-level write, then the existing strong read.
    // A lost acknowledgement can succeed only after exact independent readback.
    const readStarted = Date.now()
    const found = await read(key)
    if (canonical(found) !== canonical(record))
      throw new AppError(503, 'deletion_receipt_unverified', 'Deletion receipt is not confirmed', {
        stage: 'deletion-receipt', receipt: { phase, write,
          read: { status: found == null ? 'missing' : 'different', elapsedMs: elapsed(readStarted) } },
      })
  }
  function valid(record, operationId) {
    if (!record || record.version !== 1 || record.operationId !== operationId ||
        !USER.test(record.userId || '') || !HASH.test(record.usernameHash || '') ||
        !Number.isSafeInteger(record.startedAt) || !Number.isSafeInteger(record.expiresAt) ||
        record.expiresAt !== record.startedAt + TTL)
      throw new AppError(503, 'deletion_receipt_invalid', 'Deletion receipt is invalid')
    if (record.expiresAt <= now())
      throw new AppError(410, 'deletion_receipt_expired', 'Deletion receipt has expired')
  }
  return {
    async begin(token, operationId, identity) {
      const key = prefix(token, operationId)
      if (!USER.test(identity?.userId || '') || !HASH.test(identity?.usernameHash || ''))
        throw new AppError(503, 'deletion_identity_invalid', 'Deletion identity is invalid')
      if (await read(key + 'started.json'))
        throw new AppError(409, 'deletion_already_started', 'Read the existing deletion outcome; do not replay')
      const startedAt = now()
      const record = { version: 1, operationId, userId: identity.userId,
        usernameHash: identity.usernameHash, startedAt, expiresAt: startedAt + TTL }
      await saveOnce(key + 'started.json', record, 'started')
      return { key, record }
    },
    async complete(receipt, deleted) {
      if (!receipt || deleted?.accountDeleted !== true)
        throw new AppError(503, 'deletion_incomplete', 'Deletion is not complete')
      const started = await read(receipt.key + 'started.json')
      if (canonical(started) !== canonical(receipt.record))
        throw new AppError(503, 'deletion_receipt_changed', 'Deletion receipt changed')
      const completion = { version: 1, startedHash: hash(canonical(started)),
        completedAt: now(), deleted }
      await saveOnce(receipt.key + 'completed.json', completion, 'completed')
    },
    async status(token, operationId) {
      const key = prefix(token, operationId)
      const started = await read(key + 'started.json')
      if (!started) throw new AppError(404, 'deletion_receipt_not_found', 'Deletion outcome is unknown')
      valid(started, operationId)
      const completed = await read(key + 'completed.json')
      if (completed && (completed.version !== 1 || completed.startedHash !== hash(canonical(started)) ||
          !Number.isSafeInteger(completed.completedAt) || completed.deleted?.accountDeleted !== true))
        throw new AppError(503, 'deletion_receipt_invalid', 'Deletion receipt is invalid')
      return { operationId, userId: started.userId, state: completed ? 'completed' : 'pending',
        ...(completed ? { deleted: completed.deleted } : {}) }
    },
  }
}
