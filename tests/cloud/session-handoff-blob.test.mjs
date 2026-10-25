/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBlobHandoffBarrier } from '../../cloud-functions/_shared/session-handoff-blob.js'
import { BeforeMutationError } from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { PausableBlob } from './session-handoff-fixtures.mjs'
import { deferred } from './session-handoff-test-store.mjs'
const hash = 'a'.repeat(64)
const make = (store, extra = {}) => createBlobHandoffBarrier({ store, pollMs: 1, ...extra })
const code = value => error => error.code === value
const wait = async predicate => {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.fail('state not reached')
}

test('Blob barrier: different instances drain A before B; later A admission closes', { timeout: 5000 }, async () => {
  const store = new PausableBlob(), hold = deferred(), started = deferred()
  const a = make(store), b = make(store), c = make(store)
  const order = []
  const write = a.execute(hash, 'writer', async () => {
    order.push('A-start'); started.resolve(); await hold.promise; order.push('A-done')
  })
  await started.promise
  const login = b.execute(hash, 'handoff', async () => { order.push('B-success') })
  try {
    await wait(async () => (await c.status(hash)).pendingHandoffs === 1)
    await assert.rejects(c.execute(hash, 'writer', () => assert.fail('new A write')), code('handoff_draining'))
    assert.deepEqual(order, ['A-start'])
  } finally { hold.resolve() }
  await Promise.all([write, login])
  assert.deepEqual(order, ['A-start', 'A-done', 'B-success'])
})

test('Blob barrier: simultaneous handoffs and writers never overlap; no atomic onlyIfNew', { timeout: 10000 }, async () => {
  const store = new PausableBlob()
  let active = 0, maximum = 0
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => make(store).execute(hash, 'handoff', async () => {
    maximum = Math.max(maximum, ++active)
    await new Promise(resolve => setTimeout(resolve, i % 3))
    active--; return i
  })))
  assert.equal(maximum, 1)
  assert.equal(new Set(results).size, 16)
})

test('Blob barrier: published chooser blocks peers before its ticket exists', { timeout: 5000 }, async () => {
  const store = new PausableBlob(), chosen = deferred(), release = deferred()
  const write = store.setJSON.bind(store)
  let pauseNext = true
  store.setJSON = async (key, value) => {
    await write(key, value)
    if (pauseNext && key.endsWith('/intent-handoff.json')) {
      pauseNext = false; chosen.resolve(); await release.promise
    }
  }
  let active = false, overlap = false
  const first = make(store).execute(hash, 'handoff', async () => {
    overlap ||= active; active = true
    await new Promise(resolve => setTimeout(resolve, 2)); active = false
  })
  await chosen.promise
  let secondEntered = false
  const second = make(store).execute(hash, 'handoff', async () => {
    overlap ||= active; secondEntered = true
  })
  await wait(async () => (await make(store).status(hash)).pendingHandoffs === 2)
  assert.equal(secondEntered, false)
  release.resolve(); await Promise.all([first, second]); assert.equal(overlap, false)
})

test('Blob barrier: unknown writer result blocks B, timeout never steals ownership', async () => {
  const store = new PausableBlob()
  await assert.rejects(make(store).execute(hash, 'writer', async () => { throw new Error('unknown commit') }), /unknown commit/)
  await assert.rejects(make(store, { admissionTimeoutMs: 0 }).execute(hash, 'handoff', () => assert.fail('takeover')),
    code('handoff_timeout'))
  assert.equal((await make(store).status(hash)).activeWriters, 1)
})

test('Blob barrier: no-effect validation error safely cancels its own participant', async () => {
  const store = new PausableBlob()
  await assert.rejects(make(store).execute(hash, 'writer', async () => {
    throw new BeforeMutationError(new Error('invalid token'))
  }), /invalid token/)
  assert.equal(await make(store).execute(hash, 'handoff', async () => 7), 7)
})

test('Blob barrier: unfinished older writer survives creation of fresh instances', async () => {
  const store = new PausableBlob(), hold = deferred(), entered = deferred()
  const a = make(store).execute(hash, 'writer', async () => { entered.resolve(); await hold.promise })
  await entered.promise
  try {
    await assert.rejects(make(store, { admissionTimeoutMs: 0 }).execute(hash, 'handoff', () => assert.fail('stolen')),
      code('handoff_timeout'))
  } finally { hold.resolve() }
  await a
  assert.equal(await make(store).execute(hash, 'handoff', async () => 'after-drain'), 'after-drain')
})

test('Blob barrier: truncated or malformed listing cannot authorize work', async () => {
  for (const page of [{ blobs: [], cursor: 'next' }, { blobs: [], truncated: true },
    { blobs: [{ key: 'wrong/account' }] }, null]) {
    const store = new PausableBlob(); store.list = async () => page
    await assert.rejects(make(store).execute(hash, 'handoff', () => assert.fail('incomplete membership')))
  }
})

test('Blob barrier: forgotten self intent fails closed instead of treating empty listing as unlocked', async () => {
  const store = new PausableBlob(); store.list = async () => ({ blobs: [] })
  await assert.rejects(make(store).execute(hash, 'handoff', () => assert.fail('hidden self')),
    code('handoff_listing_incomplete'))
})

test('Blob barrier: terminal receipts and operation IDs cannot be reused', async () => {
  const store = new PausableBlob(), id = '12345678-1234-4234-8234-123456789abc'
  await make(store, { newId: () => id }).execute(hash, 'writer', async () => 1)
  await assert.rejects(make(store, { newId: () => id }).execute(hash, 'handoff', () => assert.fail('reuse')),
    code('handoff_operation_reused'))
})

test('Blob barrier: capacity is bounded by refusal, never unsafe receipt pruning', async () => {
  const store = new PausableBlob(), gate = make(store, { maxOperations: 2 })
  await gate.execute(hash, 'writer', async () => 1)
  await gate.execute(hash, 'writer', async () => 2)
  await assert.rejects(gate.execute(hash, 'handoff', () => assert.fail('capacity')),
    code('handoff_capacity_reached'))
  assert.equal((await gate.status(hash)).operations, 2)
})

test('Blob barrier: unrelated accounts do not share ownership', async () => {
  const store = new PausableBlob(), hold = deferred(), entered = deferred()
  const a = make(store).execute(hash, 'writer', async () => { entered.resolve(); await hold.promise })
  await entered.promise
  try { assert.equal(await make(store).execute('b'.repeat(64), 'handoff', async () => 'B'), 'B') }
  finally { hold.resolve() }
  await a
})
