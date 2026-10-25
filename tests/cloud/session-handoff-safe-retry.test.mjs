/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { guardedPrewriteRetry } from './session-handoff-safe-retry.mjs'
const rejected = () => ({ status: 503, data: { error: 'v4_direct_body_read_failed' }, guarded: 'account-handoff-blob-fixtures-v1' })
const success = { status: 200, data: { revision: 1 } }
const sleep = async () => {}
test('retry only typed guarded pre-write rejection after unchanged exact evidence', async () => {
  const order = []
  let n = 0
  const result = await guardedPrewriteRetry({ sleep,
    send: async () => { order.push('send'); return ++n === 1 ? rejected() : success },
    verifyUnchanged: async () => { order.push('verify'); return true } })
  assert.equal(result, success); assert.deepEqual(order, ['send', 'verify', 'send'])
})
test('unknown 503, conflict and revoked token never authorize replay', async () => {
  for (const row of [{ ...rejected(), data: { error: 'handoff_operation_outcome_unknown' } },
    { ...rejected(), data: { error: 'internal_error' } },
    { ...rejected(), status: 409 }, { ...rejected(), status: 401 }]) {
    let n = 0
    const result = await guardedPrewriteRetry({ sleep, send: async () => { n++; return row }, verifyUnchanged: () => assert.fail('must not verify') })
    assert.equal(result, row); assert.equal(n, 1)
  }
})
test('missing guarded completion cannot authorize a replay', async () => {
  let n = 0
  await guardedPrewriteRetry({ sleep, send: async () => { n++; return { ...rejected(), guarded: null } }, verifyUnchanged: () => assert.fail('unverified completion') })
  assert.equal(n, 1)
})
test('changed or unavailable revision/SHA refuses replay', async () => {
  for (const value of [false, null, undefined]) {
    let n = 0
    await assert.rejects(guardedPrewriteRetry({ sleep, send: async () => { n++; return rejected() }, verifyUnchanged: async () => value }), /evidence changed/)
    assert.equal(n, 1)
  }
})
test('lost upload response or metadata exception are not retried', async () => {
  let n = 0
  await assert.rejects(guardedPrewriteRetry({ sleep, send: async () => { n++; throw new Error('lost reply') }, verifyUnchanged: () => assert.fail('no proof') }), /lost reply/)
  assert.equal(n, 1)
  n = 0
  await assert.rejects(guardedPrewriteRetry({ sleep, send: async () => { n++; return rejected() }, verifyUnchanged: async () => { throw new Error('read unavailable') } }), /read unavailable/)
  assert.equal(n, 1)
})
test('permanent pre-write failure is bounded at three attempts, not hidden as success', async () => {
  let sent = 0, verified = 0
  const result = await guardedPrewriteRetry({ sleep, send: async () => { sent++; return rejected() }, verifyUnchanged: async () => { verified++; return true } })
  assert.equal(result.status, 503); assert.equal(sent, 3); assert.equal(verified, 2)
})
