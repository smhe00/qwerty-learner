/* eslint-env node */
import crypto from 'node:crypto'

const RATE_LIMIT_SCHEMA_VERSION = 1
const CLIENT_KEY_NAMESPACE = 'qwerty-auth-rate-v1'
const MAX_CLAIM_RETRIES = 16
const STORAGE_RETRY_DELAYS_MS = [0, 100, 250, 500]

export class AuthRateLimitStorageError extends Error {
  constructor(stage, error) {
    super('Authentication rate-limit storage is temporarily unavailable')
    this.name = 'AuthRateLimitStorageError'
    this.stage = stage
    this.originalName = error instanceof Error ? error.name : 'UnknownError'
    this.originalCode =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : null
  }
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

async function withStorageRetry(stage, operation) {
  let lastError

  for (const delayMs of STORAGE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs)

    try {
      return await operation()
    } catch (error) {
      lastError = error
    }
  }

  throw new AuthRateLimitStorageError(stage, lastError)
}

function clientKey(clientIp) {
  return crypto
    .createHash('sha256')
    .update(`${CLIENT_KEY_NAMESPACE}\0${clientIp}`)
    .digest('hex')
}

function retryAfterSeconds(nowSeconds, windowStart, windowSeconds) {
  return Math.max(1, windowStart + windowSeconds - nowSeconds)
}

function firstAvailableSlot(slots, requestLimit) {
  const occupied = new Set(slots)
  for (let slot = 1; slot <= requestLimit + 1; slot += 1) {
    if (!occupied.has(slot)) return slot
  }
  return null
}

async function bestEffortPrune(storage, key, minWindowStart) {
  if (typeof storage.pruneAuthRateLimitWindows !== 'function') return

  try {
    await withStorageRetry('prune', () =>
      storage.pruneAuthRateLimitWindows(key, minWindowStart),
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'auth_rate_limit_cleanup_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          error && typeof error === 'object' && 'originalCode' in error
            ? error.originalCode
            : null,
      }),
    )
  }
}

export async function checkAuthRateLimit({
  storage,
  clientIp,
  requestLimit = 10,
  windowSeconds = 60,
  nowMs = Date.now(),
}) {
  if (!storage) throw new Error('storage is required')
  if (typeof clientIp !== 'string' || !clientIp.trim()) {
    throw new Error('clientIp is required')
  }
  if (!Number.isInteger(requestLimit) || requestLimit < 1) {
    throw new Error('requestLimit must be a positive integer')
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('windowSeconds must be a positive integer')
  }
  if (
    typeof storage.listAuthRateLimitSlots !== 'function' ||
    typeof storage.claimAuthRateLimitSlot !== 'function'
  ) {
    throw new Error('storage does not implement auth rate-limit operations')
  }

  const normalizedIp = clientIp.trim()
  const key = clientKey(normalizedIp)
  const nowSeconds = Math.floor(Number(nowMs) / 1000)
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds
  const retryAfter = retryAfterSeconds(nowSeconds, windowStart, windowSeconds)
  const sentinelSlot = requestLimit + 1

  for (let attempt = 0; attempt < MAX_CLAIM_RETRIES; attempt += 1) {
    const slots = await withStorageRetry('list', () =>
      storage.listAuthRateLimitSlots(key, windowStart),
    )

    if (slots.includes(sentinelSlot)) {
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        windowStart,
      }
    }

    const slot = firstAvailableSlot(slots, requestLimit)
    if (slot === null) {
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        windowStart,
      }
    }

    const created = await withStorageRetry('claim', () =>
      storage.claimAuthRateLimitSlot(key, windowStart, slot, {
        schemaVersion: RATE_LIMIT_SCHEMA_VERSION,
        slot,
        windowStart,
        createdAt: new Date(Number(nowMs)).toISOString(),
      }),
    )

    if (!created) continue

    if (slot === 1) {
      await bestEffortPrune(storage, key, windowStart - windowSeconds)
    }

    if (slot > requestLimit) {
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        windowStart,
      }
    }

    return {
      allowed: true,
      remaining: requestLimit - slot,
      windowStart,
    }
  }

  return {
    allowed: false,
    retryAfterSeconds: retryAfter,
    windowStart,
  }
}
