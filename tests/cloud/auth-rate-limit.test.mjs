/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkAuthRateLimit } from '../../cloud-functions/_shared/auth-rate-limit.js'

class MemoryRateLimitStorage {
  constructor() {
    this.windows = new Map()
    this.seenClientKeys = []
  }

  key(clientKey, windowStart) {
    return `${clientKey}:${windowStart}`
  }

  async listAuthRateLimitSlots(clientKey, windowStart) {
    this.seenClientKeys.push(clientKey)
    return [...(this.windows.get(this.key(clientKey, windowStart)) || new Set())].sort(
      (a, b) => a - b,
    )
  }

  async claimAuthRateLimitSlot(clientKey, windowStart, slot) {
    this.seenClientKeys.push(clientKey)
    const key = this.key(clientKey, windowStart)
    const slots = this.windows.get(key) || new Set()

    if (slots.has(slot)) return false

    slots.add(slot)
    this.windows.set(key, slots)
    return true
  }

  async pruneAuthRateLimitWindows(clientKey, minWindowStart) {
    for (const key of [...this.windows.keys()]) {
      const separator = key.lastIndexOf(':')
      const keyClient = key.slice(0, separator)
      const windowStart = Number(key.slice(separator + 1))

      if (keyClient === clientKey && windowStart < minWindowStart) {
        this.windows.delete(key)
      }
    }
  }
}

test('auth rate limiter allows ten attempts then returns a fixed-window denial', async () => {
  const storage = new MemoryRateLimitStorage()
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
    assert.equal(result.remaining, 10 - attempt)
  }

  const denied = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs,
  })

  assert.equal(denied.allowed, false)
  assert.equal(denied.retryAfterSeconds, 60)

  assert.ok(storage.seenClientKeys.length > 0)
  assert.ok(storage.seenClientKeys.every((key) => /^[a-f0-9]{64}$/.test(key)))
  assert.ok(storage.seenClientKeys.every((key) => !key.includes(clientIp)))
})

test('auth rate limiter shares one counter across calls and resets next window', async () => {
  const storage = new MemoryRateLimitStorage()
  const clientIp = '2001:db8::1234'

  const firstWindow = 1_830_000
  for (let attempt = 0; attempt < 11; attempt += 1) {
    await checkAuthRateLimit({
      storage,
      clientIp,
      requestLimit: 10,
      windowSeconds: 60,
      nowMs: firstWindow,
    })
  }

  const nextWindow = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: 10,
    windowSeconds: 60,
    nowMs: firstWindow + 60_000,
  })

  assert.equal(nextWindow.allowed, true)
  assert.equal(nextWindow.remaining, 9)
})

test('concurrent claims never allow more than the configured request limit', async () => {
  const storage = new MemoryRateLimitStorage()
  const clientIp = '198.51.100.44'
  const nowMs = 2_400_000

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      checkAuthRateLimit({
        storage,
        clientIp,
        requestLimit: 10,
        windowSeconds: 60,
        nowMs,
      }),
    ),
  )

  assert.equal(
    results.filter((result) => result.allowed).length,
    10,
  )
  assert.equal(
    results.filter((result) => !result.allowed).length,
    10,
  )
})
