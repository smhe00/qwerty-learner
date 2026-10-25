/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPostgresHandoffStore } from '../../cloud-functions/_shared/session-handoff-postgres.js'

function fixture(failOn = null) {
  const calls = [], releases = []
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql === failOn) throw new Error(`injected ${failOn} failure`)
      return sql.startsWith('SELECT') ? { rows: [{ state: null }] } : { rows: [] }
    },
    release(discard) { releases.push(discard) },
  }
  let connections = 0
  const store = createPostgresHandoffStore({ async connect() { connections++; return client } })
  return { store, calls, releases, connections: () => connections }
}

test('one checked-out connection owns the whole durable state transaction', async () => {
  const f = fixture()
  assert.deepEqual(await f.store.transact('qualification:account', state => {
    assert.equal(state, null)
    return { state: { version: 1 }, result: { status: 'granted' } }
  }), { status: 'granted' })
  assert.equal(f.connections(), 1)
  assert.equal(f.calls[0].sql, 'BEGIN')
  assert.equal(f.calls[1].sql, 'SET LOCAL synchronous_commit = on')
  assert.ok(f.calls.find(call => call.sql.includes('FOR UPDATE')))
  assert.equal(f.calls.at(-1).sql, 'COMMIT')
  assert.deepEqual(f.releases, [false])
})

test('unknown COMMIT response is never converted to success or retried', async () => {
  const f = fixture('COMMIT')
  let transitions = 0
  await assert.rejects(f.store.transact('qualification:account', () => {
    transitions++; return { state: {}, result: { status: 'granted' } }
  }), /injected COMMIT failure/)
  assert.equal(transitions, 1)
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK')
  assert.deepEqual(f.releases, [true])
})

test('transition failure rolls back and releases the connection', async () => {
  const f = fixture()
  await assert.rejects(f.store.transact('qualification:account', () => { throw new Error('bad state') }), /bad state/)
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false)
  assert.deepEqual(f.releases, [true])
})

test('async updater is forbidden; no cloud business operation belongs inside this transaction', async () => {
  const f = fixture()
  await assert.rejects(f.store.transact('qualification:account', async () => ({ state: {}, result: {} })),
    /must be synchronous/)
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK')
})
