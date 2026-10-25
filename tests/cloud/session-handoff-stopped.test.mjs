/* eslint-env node */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { PausableBlob } from './session-handoff-fixtures.mjs'
import { deferred } from './session-handoff-test-store.mjs'

let directory, createBlobHandoffBarrier, runHandoffScope, getStore
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'handoff-stopped-'))
  const outfile = join(directory, 'entry.mjs')
  await build({ stdin: { contents: `
    export * from './cloud-functions/_shared/session-handoff-context.js';
    export * from './cloud-functions/_shared/session-handoff-blob.js';`,
    resolveDir: process.cwd() }, outfile, bundle: true, format: 'esm',
    platform: 'node', target: 'node22', logLevel: 'silent', plugins: [{
      name: 'provider-model-only', setup(builder) {
        builder.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'blob', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const getStore = () => globalThis.__handoffStoppedStore;', loader: 'js',
        }))
      },
    }] })
  ;({ createBlobHandoffBarrier, runHandoffScope, getStore } = await import(pathToFileURL(outfile)))
})
after(async () => {
  delete globalThis.__handoffStoppedStore
  await rm(directory, { recursive: true, force: true })
})
const account = 'c'.repeat(64)
const code = expected => error => error?.code === expected
function setup(options = {}) {
  const data = new PausableBlob(), markers = new PausableBlob()
  globalThis.__handoffStoppedStore = data
  return { data, markers, gate: createBlobHandoffBarrier({ store: markers,
    pollMs: 1, admissionTimeoutMs: 1000, ...options }) }
}
async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.fail('Required pending/active state was not observed')
}
const scoped = operation => runHandoffScope({ certifyStopped: true }, operation)

test('failed before writing: preserve A error and admit B without successful resync', async () => {
  const { gate } = setup()
  const failure = new Error('application could not finish')
  await assert.rejects(gate.execute(account, 'writer', () => scoped(async () => {
    throw failure
  })), error => error === failure)
  assert.equal(await gate.execute(account, 'handoff', async () => 'B'), 'B')
  assert.equal((await gate.status(account)).unresolved, 0)
})

test('failed after acknowledged writes: drain pending effect, close A, then admit B', { timeout: 3000 }, async () => {
  const { gate, data } = setup(), hold = deferred(), reached = deferred()
  const originalSet = data.setJSON.bind(data)
  data.setJSON = async (key, value) => {
    if (key === 'pending-cleanup') { reached.resolve(); await hold.promise }
    return originalSet(key, value)
  }
  const failure = new Error('business operation failed after partial progress')
  let oldStore, bEntered = false
  const a = gate.execute(account, 'writer', () => scoped(async () => {
    oldStore = getStore({ name: 'data' })
    await oldStore.setJSON('progress', { device: 'A' })
    void oldStore.setJSON('pending-cleanup', { complete: true })
    throw failure
  }))
  const aFailed = assert.rejects(a, error => error === failure)
  await reached.promise
  const b = gate.execute(account, 'handoff', async () => {
    bEntered = true
    assert.deepEqual(await data.get('pending-cleanup'), { complete: true })
    await data.setJSON('progress', { device: 'B' })
    return 'B'
  })
  try {
    await waitFor(async () => (await gate.status(account)).pendingHandoffs === 1)
    assert.equal(bEntered, false)
    await assert.rejects(gate.execute(account, 'writer', () => assert.fail('new A task')),
      code('handoff_draining'))
  } finally { hold.resolve() }
  await aFailed
  assert.equal(await b, 'B')
  assert.throws(() => oldStore.setJSON('progress', { device: 'late-A' }), code('handoff_request_closed'))
  assert.deepEqual(await data.get('progress'), { device: 'B' })
  assert.equal((await gate.status(account)).unresolved, 0)
})

test('an error HTTP response is returned unchanged and does not require upload success', async () => {
  const { gate } = setup()
  const result = await gate.execute(account, 'writer', () => scoped(async () =>
    new Response('receive failed', { status: 503 })))
  assert.equal(result.status, 503)
  assert.equal(await gate.execute(account, 'handoff', async () => 'B'), 'B')
})

test('rejected provider mutation remains uncertain even when caught by the handler', async () => {
  const { gate, data } = setup({ admissionTimeoutMs: 0 })
  data.setJSON = async () => { throw new Error('write acknowledgement lost') }
  await assert.rejects(gate.execute(account, 'writer', () => scoped(async () => {
    try { await getStore({ name: 'data' }).setJSON('progress', {}) } catch { /* handler handles failure */ }
    return new Response('failed', { status: 503 })
  })), code('handoff_operation_outcome_unknown'))
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('uncertain A')),
    code('handoff_timeout'))
  assert.equal((await gate.status(account)).activeWriters, 1)
})

test('unknown write takes precedence over a later business failure', async () => {
  const { gate, data } = setup({ admissionTimeoutMs: 0 })
  data.setJSON = async () => { throw new Error('storage result unknown') }
  await assert.rejects(gate.execute(account, 'writer', () => scoped(async () => {
    try { await getStore({ name: 'data' }).setJSON('progress', {}) } catch { /* retained by scope */ }
    throw new Error('secondary application failure')
  })), code('handoff_operation_outcome_unknown'))
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('uncertain A')),
    code('handoff_timeout'))
})

test('unverified terminal receipt is not mistaken for released ownership', async () => {
  const { gate, markers } = setup({ admissionTimeoutMs: 0 })
  const set = markers.setJSON.bind(markers)
  markers.setJSON = async (key, value) => {
    if (key.endsWith('/done-done.json')) throw new Error('completion receipt unverified')
    return set(key, value)
  }
  await assert.rejects(gate.execute(account, 'writer', () => scoped(async () => {
    throw new Error('ended business error')
  })), code('handoff_write_unverified'))
  await assert.rejects(gate.execute(account, 'handoff', () => assert.fail('receipt absent')),
    code('handoff_timeout'))
})

// Compatibility: a scope without an owning barrier must keep its original
// error identity. It still drains and closes before the caller sees the error.
test('standalone scope preserves original error and rejects detached writes', async () => {
  const { data } = setup()
  const failure = new Error('known stopped caller')
  let oldStore
  await assert.rejects(runHandoffScope({}, async () => {
    oldStore = getStore({ name: 'data' })
    await oldStore.setJSON('progress', { saved: true })
    throw failure
  }), error => error === failure)
  assert.throws(() => oldStore.setJSON('progress', { saved: false }), code('handoff_request_closed'))
  assert.deepEqual(await data.get('progress'), { saved: true })
})
