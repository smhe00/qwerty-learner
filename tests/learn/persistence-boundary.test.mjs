import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import ts from 'typescript'

// Execute the production modules. Only the store-owned queue port is replaced;
// no source matching assertions and no duplicate implementation of the registry.
function load(relativePath, dependencies = {}) {
  const source = readFileSync(new URL('../../' + relativePath, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  const nativeRequire = createRequire(import.meta.url)
  new Function('module', 'exports', 'require', output)(module, module.exports, (name) => dependencies[name] ?? nativeRequire(name))
  return module.exports
}

const { requireDurableWordRecordId } = load('src/learn/durable-word-record.ts')

test('only valid persisted local IDs cross the Learn completion boundary', () => {
  for (const id of [-1, 0, NaN, Infinity, -Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1, undefined, null, '42']) {
    assert.throws(() => requireDurableWordRecordId(id), /本词尚未推进/)
  }
  assert.equal(requireDurableWordRecordId(42), 42)
})

test('handled persistence failure creates no unhandled rejection and registry still drains', async () => {
  let flushes = 0
  const { trackLearnPersistence, flushLearnPersistence } = load('src/learn/persistence.ts', {
    '@/utils/db/review-record-writer': { flushReviewRecordWrites: async () => { flushes++ } },
  })
  const failure = new Error('raw transaction aborted')
  await assert.rejects(trackLearnPersistence(Promise.reject(failure)), (error) => error === failure)
  let release
  const write = new Promise((resolve) => { release = resolve })
  assert.equal(trackLearnPersistence(write), write)
  let drained = false
  const draining = flushLearnPersistence().then(() => { drained = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  release()
  await draining
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(flushes >= 2)
  // node:test fails this test if a detached finally() promise rejects.
})

test('flush also waits for a derived write scheduled as an earlier write settles', async () => {
  const { trackLearnPersistence, flushLearnPersistence } = load('src/learn/persistence.ts', {
    '@/utils/db/review-record-writer': { flushReviewRecordWrites: async () => {} },
  })
  let releaseFirst, releaseSecond
  const first = new Promise((resolve) => { releaseFirst = resolve })
  const second = new Promise((resolve) => { releaseSecond = resolve })
  trackLearnPersistence(first)
  void first.then(() => trackLearnPersistence(second))
  let drained = false
  const draining = flushLearnPersistence().then(() => { drained = true })
  releaseFirst()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  releaseSecond()
  await draining
})
