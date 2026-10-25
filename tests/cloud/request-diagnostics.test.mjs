/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestDiagnostics } from '../../cloud-functions/_shared/request-diagnostics.js'

test('request diagnostics preserve sync/async values, exact errors and receiver', async () => {
  const original = new Error('private content must never be copied')
  const adapter = { count: 3,
    sync() { return this.count }, async asyncRead() { return this.count },
    async getAccount() { throw original } }
  const trace = createRequestDiagnostics({ uuid: 'eolog-test-123' })
  const storage = trace.storage(adapter)
  assert.equal(storage.sync(), 3)
  assert.equal(await storage.asyncRead(), 3)
  await assert.rejects(trace.run('account-login', () => storage.getAccount('private-key')), error => error === original)
  assert.equal(trace.stageFor(original), 'storage-getAccount')
  assert.equal(trace.requestId, 'eolog-test-123')
  assert.ok(!JSON.stringify(trace).includes('private'))
})

test('handled retention errors cannot misattribute a later unrelated failure', async () => {
  const trace = createRequestDiagnostics()
  const retention = new Error('retention failure')
  const transport = new TypeError('private body-read failure')
  await trace.run('retention', async () => { throw retention }).catch(() => undefined)
  await assert.rejects(trace.run('request-body', async () => { throw transport }), error => error === transport)
  assert.equal(trace.stageFor(transport), 'request-body')
  assert.equal(trace.stageFor(new Error('unknown')), undefined)
  assert.equal(createRequestDiagnostics({ uuid: 'unsafe?password=value' }).requestId, undefined)
})
