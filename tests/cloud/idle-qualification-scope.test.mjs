/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { qualificationScope, qualifyIdleLifecycle } from '../../scripts/idle-blob-qualification-core.mjs'

function stores() {
  const objects = new Map()
  const calls = []
  const raw = () => ({
    async get(key) { calls.push(['get', key]); return structuredClone(objects.get(key) ?? null) },
    async setJSON(key, value) { calls.push(['set', key]); objects.set(key, structuredClone(value)) },
    async delete(key) { calls.push(['delete', key]); objects.delete(key) },
    async list({ prefix }) {
      calls.push(['list', prefix])
      return { blobs: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
    },
  })
  return { objects, calls, clients: [raw(), raw()] }
}

test('all reads, writes, lists and deletes remain inside a random per-case root', async () => {
  const f = stores()
  const q = qualificationScope(f.clients)
  const a = q.namespace('fixture')
  const b = q.namespace('fixture', 1)
  await a.setJSON('accounts/owner/identity.json', { synthetic: true })
  assert.deepEqual(await b.get('accounts/owner/identity.json'), { synthetic: true })
  assert.deepEqual((await b.list({ prefix: 'accounts/' })).blobs.map(blob => blob.key), ['accounts/owner/identity.json'])
  await a.delete('accounts/owner/identity.json')
  assert.ok(f.calls.every(([, key]) => key.startsWith(q.root + 'fixture/')))
  assert.equal((await q.cleanup()).confirmed, true)
})

test('unsafe paths and invalid namespaces fail before any SDK access', async () => {
  const f = stores()
  const q = qualificationScope(f.clients)
  for (const name of ['../account', '/account', '', 'UPPERCASE']) assert.throws(() => q.namespace(name))
  const store = q.namespace('fixture')
  for (const key of ['../users/a', '/users/a', 'users/../a', 'users//a', '', 'users/a/']) {
    await assert.rejects(store.get(key))
    await assert.rejects(store.setJSON(key, {}))
    await assert.rejects(store.delete(key))
  }
  assert.equal(f.calls.length, 0)
})

test('foreign provider list cannot escape to production or another sandbox', async () => {
  const f = stores()
  f.clients[0].list = async () => ({ blobs: [{ key: 'accounts/not-our-fixture/identity.json' }] })
  const q = qualificationScope(f.clients)
  await assert.rejects(q.namespace('fixture').list({ prefix: 'accounts/' }))
  assert.equal(f.calls.length, 0)
})

test('ambiguous write is ledgered before dispatch and known-key cleanup preserves strangers', async () => {
  const f = stores()
  const evidence = []
  const original = f.clients[0].setJSON
  f.clients[0].setJSON = async (key, value) => {
    assert.ok(evidence.at(-1).keys.includes(key))
    await original(key, value)
    throw Error('synthetic lost ACK')
  }
  const q = qualificationScope(f.clients, { onTrack: value => evidence.push(value) })
  f.objects.set('production-sentinel', { preserve: true })
  const unknown = q.root + 'not-written-by-us.json'
  f.objects.set(unknown, { preserve: true })
  await assert.rejects(q.namespace('fixture').setJSON('users/a/payload.json', { synthetic: true }))
  const result = await q.cleanup()
  assert.equal(result.confirmed, false, 'An untracked residual must not be called fully cleaned')
  assert.equal(result.remaining, 1)
  assert.deepEqual(f.objects.get('production-sentinel'), { preserve: true })
  assert.deepEqual(f.objects.get(unknown), { preserve: true })
  assert.ok(!f.calls.some(([method, key]) => method === 'delete' && key === unknown))
})

test('full qualification fixtures and failure hooks exercise the actual production engine', async () => {
  const f = stores()
  const result = await qualifyIdleLifecycle({ clients: f.clients })
  assert.equal(result.verdict, 'PASS', JSON.stringify(result))
  assert.equal(result.cases.length, 8)
  assert.ok(result.cases.every(row => row.passed))
  assert.equal(result.realBlobTested, false)
  assert.equal(result.multiRegionQualified, false)
  assert.equal(result.cleanup.confirmed, true)
  assert.equal(f.objects.size, 0)
})
