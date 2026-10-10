import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAsyncOwnershipGuard,
} from '../../src/learn/async-ownership'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushAsyncTurn() {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

test('newer Learn preparation owns completion and suppresses an older dictionary result', async () => {
  const guard = createAsyncOwnershipGuard()
  const oldClaim = guard.begin()
  const oldResult = deferred<string>()
  const nextClaim = guard.begin()
  const nextResult = deferred<string>()
  const committed: string[] = []

  void oldResult.promise.then((value) => {
    if (oldClaim.isCurrent()) committed.push(value)
  })
  void nextResult.promise.then((value) => {
    if (nextClaim.isCurrent()) committed.push(value)
  })

  oldResult.resolve('old-dict')
  await flushAsyncTurn()
  assert.deepEqual(committed, [])

  nextResult.resolve('new-dict')
  await flushAsyncTurn()
  assert.deepEqual(committed, ['new-dict'])
})

test('leaving Learn invalidates an in-flight preparation even if it resolves later', async () => {
  const guard = createAsyncOwnershipGuard()
  const claim = guard.begin()
  const result = deferred<string>()
  const committed: string[] = []

  void result.promise.then((value) => {
    if (claim.isCurrent()) committed.push(value)
  })

  guard.deactivate()
  result.resolve('late-learn-session')
  await flushAsyncTurn()

  assert.deepEqual(committed, [])
})

test('reactivating Learn creates a new valid owner without reviving an old claim', () => {
  const guard = createAsyncOwnershipGuard()
  const first = guard.begin()
  guard.deactivate()
  guard.activate()
  const second = guard.begin()

  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  assert.ok(second.generation > first.generation)
})

test('deactivated Learn rejects new claims until explicit reactivation', () => {
  const guard = createAsyncOwnershipGuard()
  const former = guard.begin()
  guard.deactivate()
  const dormant = guard.begin()
  assert.equal(former.isCurrent(), false)
  assert.equal(dormant.isCurrent(), false,
    'a deferred async callback must not claim ownership on an inactive page')
  guard.activate()
  const resumed = guard.begin()
  assert.equal(dormant.isCurrent(), false)
  assert.equal(resumed.isCurrent(), true)
})

test('old ownership invalidation cannot cancel a newer active request', () => {
  const guard = createAsyncOwnershipGuard()
  const first = guard.begin()
  const newest = guard.begin()
  assert.equal(newest.isCurrent(), true)
  first.invalidate()
  assert.equal(first.isCurrent(), false)
  assert.equal(newest.isCurrent(), true,
    'late cancellation of superseded work must not invalidate the current owner')
  newest.invalidate()
  assert.equal(newest.isCurrent(), false)
})
