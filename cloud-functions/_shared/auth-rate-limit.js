/* eslint-env node */
import crypto from 'node:crypto'

const RATE_LIMIT_SCHEMA_VERSION = 2
const CLIENT_KEY_NAMESPACE = 'qwerty-auth-rate-v1'
const STORAGE_RETRY_DELAYS_MS = [0, 100, 250]
const MAX_LOCAL_CLIENTS = 8192

const localCounters = new Map()

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

async function withStorageRetry(operation) {
  let lastError

  for (const delayMs of STORAGE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs)

    try {
      return await operation()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
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

function pruneLocalCounters(currentWindowStart, windowSeconds) {
  if (localCounters.size <= MAX_LOCAL_CLIENTS) return

  const oldestAllowedWindow = currentWindowStart - windowSeconds

  for (const [key, value] of localCounters.entries()) {
    if (value.windowStart < oldestAllowedWindow) {
      localCounters.delete(key)
    }
  }

  while (localCounters.size > MAX_LOCAL_CLIENTS) {
    const firstKey = localCounters.keys().next().value
    if (firstKey === undefined) break
    localCounters.delete(firstKey)
  }
}

function incrementLocalCounter(key, windowStart, windowSeconds) {
  const current = localCounters.get(key)

  if (!current || current.windowStart !== windowStart) {
    const next = { windowStart, count: 1 }
    localCounters.set(key, next)
    pruneLocalCounters(windowStart, windowSeconds)
    return next.count
  }

  current.count += 1
  return current.count
}

async function bestEffortSharedCount({
  storage,
  key,
  windowStart,
  countFloor,
  nowMs,
  windowSeconds,
}) {
  if (
    typeof storage?.getAuthRateLimitCounter !== 'function' ||
    typeof storage?.setAuthRateLimitCounter !== 'function'
  ) {
    return null
  }

  try {
    const current = await withStorageRetry(() =>
      storage.getAuthRateLimitCounter(key, windowStart),
    )

    const previousCount =
      current &&
      current.windowStart === windowStart &&
      Number.isInteger(current.count) &&
      current.count >= 0
        ? current.count
        : 0

    const nextCount = Math.max(previousCount + 1, countFloor)

    await withStorageRetry(() =>
      storage.setAuthRateLimitCounter(key, windowStart, {
        schemaVersion: RATE_LIMIT_SCHEMA_VERSION,
        windowStart,
        count: nextCount,
        updatedAt: new Date(Number(nowMs)).toISOString(),
      }),
    )

    if (countFloor === 1 && typeof storage.pruneAuthRateLimitCounters === 'function') {
      storage
        .pruneAuthRateLimitCounters(key, windowStart - windowSeconds)
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: 'auth_rate_limit_cleanup_failed',
              errorName: error instanceof Error ? error.name : 'UnknownError',
              errorCode:
                error && typeof error === 'object' && 'code' in error
                  ? String(error.code)
                  : null,
            }),
          )
        })
    }

    return nextCount
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'auth_rate_limit_shared_storage_unavailable',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : null,
      }),
    )
    return null
  }
}

export function resetAuthRateLimitMemoryForTest() {
  localCounters.clear()
}

export async function checkAuthRateLimit({
  storage,
  clientIp,
  requestLimit = 10,
  windowSeconds = 60,
  nowMs = Date.now(),
}) {
  if (typeof clientIp !== 'string' || !clientIp.trim()) {
    throw new Error('clientIp is required')
  }
  if (!Number.isInteger(requestLimit) || requestLimit < 1) {
    throw new Error('requestLimit must be a positive integer')
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('windowSeconds must be a positive integer')
  }

  const key = clientKey(clientIp.trim())
  const nowSeconds = Math.floor(Number(nowMs) / 1000)
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds
  const retryAfter = retryAfterSeconds(nowSeconds, windowStart, windowSeconds)

  const localCount = incrementLocalCounter(key, windowStart, windowSeconds)

  if (localCount > requestLimit) {
    return {
      allowed: false,
      retryAfterSeconds: retryAfter,
      windowStart,
      source: 'local',
    }
  }

  const sharedCount = await bestEffortSharedCount({
    storage,
    key,
    windowStart,
    countFloor: localCount,
    nowMs,
    windowSeconds,
  })

  if (sharedCount !== null && sharedCount > requestLimit) {
    return {
      allowed: false,
      retryAfterSeconds: retryAfter,
      windowStart,
      source: 'shared',
    }
  }

  const effectiveCount =
    sharedCount === null ? localCount : Math.max(localCount, sharedCount)

  return {
    allowed: true,
    remaining: Math.max(0, requestLimit - effectiveCount),
    windowStart,
    source: sharedCount === null ? 'local' : 'hybrid',
  }
}

// Release-candidate verification marker: no functional behavior change.
