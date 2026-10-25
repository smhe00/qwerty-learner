/* eslint-env node */
import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { createPostgresHandoffStore } from '../../cloud-functions/_shared/session-handoff-postgres.js'
import { createSessionHandoffBarrier, transitionHandoff } from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { deferred } from './session-handoff-test-store.mjs'

// A missing real DB is a FAILURE, never a skipped/passing qualification.
if (!process.env.HANDOFF_PG_DEPS || !process.env.HANDOFF_TEST_DATABASE_URL) {
  throw new Error('Explicit isolated PostgreSQL test database and pg dependency path required')
}
const { Pool } = createRequire(`${process.env.HANDOFF_PG_DEPS}/package.json`)('pg')
const options = { connectionString: process.env.HANDOFF_TEST_DATABASE_URL, max: 8 }
const poolA = new Pool(options), poolB = new Pool(options)
const storeA = createPostgresHandoffStore(poolA), storeB = createPostgresHandoffStore(poolB)
const namespace = `qualification_${randomBytes(8).toString('hex')}`
const newKey = () => randomBytes(32).toString('hex')
const gate = store => createSessionHandoffBarrier({ store, namespace, pollMs: 5 })

before(async () => {
  await poolA.query(await readFile(new URL('../../experimental/session-handoff/postgres.sql', import.meta.url), 'utf8'))
})
after(async () => {
  // Only this test's random namespace, in a disposable CI PostgreSQL service.
  try { await poolA.query('DELETE FROM qwerty_handoff.account_barriers WHERE account_key LIKE $1', [`${namespace}:%`]) }
  finally { await Promise.all([poolA.end(), poolB.end()]) }
})

async function waitForState(key, predicate) {
  for (let i = 0; i < 500; i++) {
    const read = await poolB.query('SELECT state FROM qwerty_handoff.account_barriers WHERE account_key = $1',
      [`${namespace}:${key}`])
    if (read.rows[0] && predicate(read.rows[0].state)) return read.rows[0].state
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Expected PostgreSQL barrier state not observed')
}

test('real PostgreSQL: concurrent connections cannot lose state transitions', { timeout: 15_000 }, async () => {
  const key = `${namespace}:${newKey()}`
  const values = await Promise.all(Array.from({ length: 24 }, (_, i) =>
    (i % 2 ? storeA : storeB).transact(key, current => {
      const count = (current?.count || 0) + 1
      return { state: { count }, result: count }
    })))
  assert.deepEqual(values.sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1))
})

test('real PostgreSQL: separate pools drain a writer before granting takeover', { timeout: 15_000 }, async () => {
  const key = newKey(), hold = deferred()
  const order = []
  const a = gate(storeA).execute(key, 'writer', async () => {
    order.push('A-start'); await hold.promise; order.push('A-complete')
  })
  await waitForState(key, state => Boolean(state.active))
  const b = gate(storeB).execute(key, 'handoff', async () => { order.push('B-login') })
  try {
    await waitForState(key, state => Boolean(state.pending))
    await assert.rejects(gate(storeA).execute(key, 'writer', () => assert.fail('new write')),
      error => error.code === 'handoff_draining')
    assert.deepEqual(order, ['A-start'])
  } finally { hold.resolve() }
  await Promise.all([a, b])
  assert.deepEqual(order, ['A-start', 'A-complete', 'B-login'])
})

test('real PostgreSQL: durable owner survives disconnect; no timeout takeover', { timeout: 15_000 }, async () => {
  const key = newKey(), id = randomUUID()
  const disposablePool = new Pool(options)
  const disposableStore = createPostgresHandoffStore(disposablePool)
  await disposableStore.transact(`${namespace}:${key}`,
    state => transitionHandoff(state, { action: 'enter', id, kind: 'writer' }))
  await disposablePool.end()
  const b = createSessionHandoffBarrier({ store: storeB, namespace, admissionTimeoutMs: 0 })
  await assert.rejects(b.execute(key, 'handoff', () => assert.fail('orphaned writer')),
    error => error.code === 'handoff_timeout')
  const state = await waitForState(key, state => state.active?.id === id)
  assert.equal(state.active.id, id)
})

test('real PostgreSQL: terminal receipt prevents delayed request resurrection', { timeout: 15_000 }, async () => {
  const key = `${namespace}:${newKey()}`, id = randomUUID()
  await storeA.transact(key, state => transitionHandoff(state, { action: 'cancel', id, kind: 'handoff' }))
  const result = await storeB.transact(key, state => transitionHandoff(state, { action: 'enter', id, kind: 'handoff' }))
  assert.equal(result.status, 'cancelled')
})
