/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  createSessionHandoffBarrier, transitionHandoff, BeforeMutationError,
} from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { AtomicTestStore, deferred } from './session-handoff-test-store.mjs'

const account = 'a'.repeat(64)
const config = store => ({ store, namespace: 'unit-handoff', pollMs: 1 })
const code = expected => error => error.code === expected
const tick = () => new Promise(resolve => setImmediate(resolve))

test('missing atomic provider fails closed; no implicit local lock', () => {
  assert.throws(() => createSessionHandoffBarrier({ namespace: 'unit' }),
    code('handoff_atomic_store_required'))
})

test('separate barriers drain A, refuse new A writes, then admit B', { timeout: 3000 }, async () => {
  const store = new AtomicTestStore()
  const a = createSessionHandoffBarrier(config(store))
  const b = createSessionHandoffBarrier(config(store))
  const hold = deferred()
  const order = []
  const writing = a.execute(account, 'writer', async () => {
    order.push('A started'); await hold.promise; order.push('A committed')
  })
  await store.when(s => s.active?.kind === 'writer')
  const login = b.execute(account, 'handoff', async () => { order.push('B logged in') })
  await store.when(s => Boolean(s.pending))
  await assert.rejects(a.execute(account, 'writer', () => assert.fail('must not start')),
    code('handoff_draining'))
  assert.deepEqual(order, ['A started'])
  hold.resolve()
  await Promise.all([writing, login])
  assert.deepEqual(order, ['A started', 'A committed', 'B logged in'])
})

test('two handoffs cannot both own the account', { timeout: 3000 }, async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier(config(store))
  const hold = deferred()
  const writing = gate.execute(account, 'writer', () => hold.promise)
  await store.when(s => Boolean(s.active))
  const b = gate.execute(account, 'handoff', async () => 'B')
  await store.when(s => Boolean(s.pending))
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('C must not run')),
    code('handoff_busy'))
  hold.resolve(); await writing; assert.equal(await b, 'B')
})

test('concurrent writes by the same device are refused before side effects', async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier(config(store))
  const hold = deferred()
  const a = gate.execute(account, 'writer', () => hold.promise)
  await store.when(s => Boolean(s.active))
  await assert.rejects(gate.execute(account, 'writer', () => assert.fail('overlap')),
    code('handoff_busy'))
  hold.resolve(); await a
})

test('an admission timeout never unlocks a running write', async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier({ ...config(store), admissionTimeoutMs: 0 })
  const hold = deferred()
  const a = gate.execute(account, 'writer', () => hold.promise)
  await store.when(s => Boolean(s.active))
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('premature B')),
    code('handoff_timeout'))
  const [state] = store.states.values()
  assert.equal(state.active.kind, 'writer'); assert.equal(state.pending, null)
  hold.resolve(); await a
  assert.equal(await gate.execute(account, 'handoff', async () => 'B'), 'B')
})

test('long-running operation is not released when the admission deadline passes', async () => {
  const store = new AtomicTestStore()
  let now = 0
  const gate = createSessionHandoffBarrier({ ...config(store), clock: () => now, admissionTimeoutMs: 1 })
  const hold = deferred()
  const a = gate.execute(account, 'writer', () => hold.promise)
  await store.when(s => Boolean(s.active))
  now = 1_000_000
  await tick()
  assert.equal([...store.states.values()][0].active.kind, 'writer')
  hold.resolve(); await a
})

test('ambiguous mutation failure blocks takeover instead of unlocking in finally', async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier(config(store))
  const failure = new Error('provider response lost after possible write')
  await assert.rejects(gate.execute(account, 'writer', async () => { throw failure }),
    error => error === failure)
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('unknown outcome')),
    code('handoff_blocked'))
  const state = [...store.states.values()][0]
  assert.ok(state.active); assert.ok(state.blocked)
})

test('explicitly proven pre-mutation rejection can release the barrier', async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier(config(store))
  const rejection = new Error('token invalid before any storage mutation')
  await assert.rejects(gate.execute(account, 'writer', async () => {
    throw new BeforeMutationError(rejection)
  }), error => error === rejection)
  assert.equal(await gate.execute(account, 'handoff', async () => 'B'), 'B')
})

test('lost acquisition response does not run business work or fall back', async () => {
  const memory = new AtomicTestStore()
  const store = { async transact(...args) {
    await memory.transact(...args); throw new Error('response lost')
  } }
  const gate = createSessionHandoffBarrier(config(store))
  await assert.rejects(gate.execute(account, 'writer', () => assert.fail('unknown grant')),
    code('handoff_state_unavailable'))
  assert.ok([...memory.states.values()][0].active)
})

test('lost release response cannot produce a claimed successful login', async () => {
  const memory = new AtomicTestStore()
  let calls = 0
  const store = { async transact(...args) {
    const result = await memory.transact(...args)
    if (++calls === 2) throw new Error('release response lost')
    return result
  } }
  const gate = createSessionHandoffBarrier(config(store))
  await assert.rejects(gate.execute(account, 'handoff', async () => 'token'),
    code('handoff_state_unavailable'))
})

test('unrelated accounts and isolated environments do not block one another', async () => {
  const store = new AtomicTestStore()
  const gate = createSessionHandoffBarrier(config(store))
  const other = createSessionHandoffBarrier({ ...config(store), namespace: 'other-env' })
  const hold = deferred()
  const a = gate.execute(account, 'writer', () => hold.promise)
  await store.when(s => Boolean(s.active))
  assert.equal(await gate.execute('b'.repeat(64), 'handoff', async () => 2), 2)
  assert.equal(await other.execute(account, 'handoff', async () => 3), 3)
  hold.resolve(); await a
})

test('cancelled operation cannot be resurrected by a delayed admission RPC', () => {
  const id = randomUUID()
  let result = transitionHandoff(null, { action: 'cancel', id, kind: 'handoff' })
  result = transitionHandoff(result.state, { action: 'enter', id, kind: 'handoff' })
  assert.equal(result.result.status, 'cancelled'); assert.equal(result.state.active, null)
})

test('completed operation cannot acquire ownership again', () => {
  const id = randomUUID()
  let result = transitionHandoff(null, { action: 'enter', id, kind: 'writer' })
  result = transitionHandoff(result.state, { action: 'finish', id, kind: 'writer' })
  result = transitionHandoff(result.state, { action: 'enter', id, kind: 'writer' })
  assert.equal(result.result.status, 'done'); assert.equal(result.state.active, null)
})

test('foreign finish cannot release another operation', () => {
  const state = transitionHandoff(null, { action: 'enter', id: randomUUID(), kind: 'writer' }).state
  assert.throws(() => transitionHandoff(state, { action: 'finish', id: randomUUID(), kind: 'writer' }),
    code('handoff_not_owner'))
})

test('operation ID cannot be reused for another operation kind', () => {
  const id = randomUUID()
  const state = transitionHandoff(null, { action: 'enter', id, kind: 'writer' }).state
  assert.throws(() => transitionHandoff(state, { action: 'enter', id, kind: 'handoff' }),
    code('handoff_operation_reused'))
})

test('invalid state, account key and configuration fail closed', async () => {
  assert.throws(() => createSessionHandoffBarrier({ ...config(new AtomicTestStore()), pollMs: 0 }))
  const gate = createSessionHandoffBarrier(config(new AtomicTestStore()))
  await assert.rejects(gate.execute('../other-account', 'writer', () => assert.fail('bad key')),
    code('handoff_invalid_operation'))
  assert.throws(() => transitionHandoff({}, { action: 'enter', id: randomUUID(), kind: 'writer' }),
    code('handoff_invalid_state'))
})
