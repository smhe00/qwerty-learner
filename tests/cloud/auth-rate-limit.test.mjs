/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkAuthRateLimit,
  resetAuthRateLimitMemoryForTest,
} from '../../cloud-functions/_shared/auth-rate-limit.js'

class MemorySharedRateLimitStorage {
  constructor() {
    this.counters = new Map()
    this.failReads = false
    this.failWrites = false
  }

  key(clientKey, windowStart) {
    return `${clientKey}:${windowStart}`
  }

  async getAuthRateLimitCounter(clientKey, windowStart) {
    if (this.failReads) throw new Error('shared read unavailable')
    return this.counters.get(this.key(clientKey, windowStart)) || null
  }

  async setAuthRateLimitCounter(clientKey, windowStart, record) {
    if (this.failWrites) throw new Error('shared write unavailable')
    this.counters.set(this.key(clientKey, windowStart), { ...record })
  }

  async pruneAuthRateLimitCounters(clientKey, minWindowStart) {
    for (const key of [...this.counters.keys()]) {
      const separator = key.lastIndexOf(':')
      const keyClient = key.slice(0, separator)
      const windowStart = Number(key.slice(separator + 1))

      if (keyClient === clientKey && windowStart < minWindowStart) {
        this.counters.delete(key)
      }
    }
  }
}

test.beforeEach(() => {
  resetAuthRateLimitMemoryForTest()
})

test('hybrid auth limiter allows ten attempts then blocks locally', async () => {
  const storage = new MemorySharedRateLimitStorage()
  const clientIp = '203.0.113.9'
  const nowMs = 1_800_000

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await checkAuthRateLimit({
      storage,
      clientIp,
      requestLimit: 10,
      windowSeconds: 60,
      nowMs,
    })

    assert.equal(result.allowed, true)
  }

  const denied = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs,
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.source, 'local')
  assert.equal(denied.retryAfterSeconds, 60)
})

test('hybrid auth limiter resets on the next fixed window', async () => {
  const storage = new MemorySharedRateLimitStorage()
  const clientIp = '2001:db8::1234'

  for (let attempt = 0; attempt < 11; attempt += 1) {
    await checkAuthRateLimit({
      storage,
      clientIp,
      requestLimit: 10,
      windowSeconds: 60,
      nowMs: 1_830_000,
    })
  }

  const nextWindow = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs: 1_890_000,
  })

  assert.equal(nextWindow.allowed, true)
})

test('shared storage failure never turns authentication limiter into a 500 dependency', async () => {
  const storage = new MemorySharedRateLimitStorage()
  storage.failReads = true
  storage.failWrites = true

  const clientIp = '198.51.100.44'
  const nowMs = 2_400_000

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await checkAuthRateLimit({
      storage,
      clientIp,
      requestLimit: 10,
      windowSeconds: 60,
      nowMs,
    })
    assert.equal(result.allowed, true)
    assert.equal(result.source, 'local')
  }

  const denied = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs,
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.source, 'local')
})

test('shared counter can block an instance earlier when another instance already consumed budget', async () => {
  const storage = new MemorySharedRateLimitStorage()
  const clientIp = '192.0.2.55'
  const nowMs = 3_000_000

  const first = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs,
  })
  assert.equal(first.allowed, true)

  const [onlyKey] = storage.counters.keys()
  const existing = storage.counters.get(onlyKey)
  storage.counters.set(onlyKey, { ...existing, count: 10 })

  const second = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs,
  })

  assert.equal(second.allowed, false)
  assert.equal(second.source, 'shared')
})
