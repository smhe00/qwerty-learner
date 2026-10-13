import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureSignedInLearnClock, learningClockEpochMs } from '../../src/sync/learning-clock'
import { getUTCUnixTimestamp } from '../../src/utils/time'

/** Real module integration with only auth storage and EdgeOne health mocked. */
test('signed-in Learn clock ignores <=60s and adjusts >60s; cache stays account scoped', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    },
  })
  let serverOffsetMs = 25_000
  let requests = 0
  globalThis.fetch = (async (path: string | URL | Request) => {
    assert.equal(String(path), '/api/health')
    requests++
    return new Response(JSON.stringify({
      ok: true, serverTimeMs: Date.now() + serverOffsetMs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const login = (userId: string) => {
    memory.set('qwerty.cloudAuth.v1', JSON.stringify({
      user: { userId, username: userId },
      token: 'token-' + userId, expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }))
  }
  try {
    login('account-A')
    const near = await ensureSignedInLearnClock()
    assert.equal(near.status, 'calibrated')
    assert.equal(near.appliedOffsetMs, 0)
    assert.ok(Math.abs(learningClockEpochMs() - Date.now()) < 1_500)
    const requestsAfterFirst = requests
    await ensureSignedInLearnClock()
    assert.equal(requests, requestsAfterFirst, 'repeat start uses one calibration cache')

    serverOffsetMs = 125_000
    login('account-B')
    const far = await ensureSignedInLearnClock()
    assert.equal(far.status, 'calibrated')
    assert.ok(Math.abs(far.appliedOffsetMs - serverOffsetMs) < 1_500)
    assert.ok(Math.abs(learningClockEpochMs() - Date.now() - serverOffsetMs) < 1_500)
    assert.ok(Math.abs(getUTCUnixTimestamp() * 1000 - (Date.now() + serverOffsetMs)) < 1_500)

    // Cloud logout must immediately stop reusing account-B time correction.
    memory.delete('qwerty.cloudAuth.v1')
    assert.ok(Math.abs(learningClockEpochMs() - Date.now()) < 1_500)
    const anon = await ensureSignedInLearnClock()
    assert.equal(anon.status, 'not-signed-in')
    assert.equal(requests, requestsAfterFirst + 3)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('missing serverTimeMs never blocks learning or silently trusts server', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: () => JSON.stringify({
      user: { userId: 'unavailable-account', username: 'unavailable' },
      token: 'unavailable-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }), removeItem: () => undefined },
  })
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }),
    { status: 200 })) as typeof fetch
  try {
    const state = await ensureSignedInLearnClock()
    assert.equal(state.status, 'unavailable')
    assert.equal(state.appliedOffsetMs, 0)
    assert.ok(Math.abs(learningClockEpochMs() - Date.now()) < 1_500)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
