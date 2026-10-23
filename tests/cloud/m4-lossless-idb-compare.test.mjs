import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m4-lossless-'))
const out = join(dir, 'strict-idb.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/m4-lossless-idb-compare.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json'),
})
after(() => rmSync(dir, { recursive: true, force: true }))
const { sameLosslessIndexedDbValue: same } =
  await import(pathToFileURL(out).href)

test('identical Learn ReviewRecord words and optional fields survive scratch comparison', () => {
  const record = [{
    id: 1, sessionId: 'test-session',
    words: [{ name: 'alpha', trans: ['first'], index: 1,
      nested: [0, false, null, undefined, NaN, Infinity, -Infinity] }],
    exercisePlans: { alpha: { value: undefined, due: new Date('2025-01-01') } },
  }]
  assert.equal(same(record, structuredClone(record)), true)
  assert.equal(same([], []), true)
})

test('different word, missing event and session index are never accepted', () => {
  const source = [{ id: 1, words: [{ name: 'alpha', trans: ['first'] }] }]
  assert.equal(same(source, [{ id: 1, words: [{ name: 'beta', trans: ['first'] }] }]), false)
  assert.equal(same(source, []), false)
  assert.equal(same(source, [{ id: 2, words: [{ name: 'alpha', trans: ['first'] }] }]), false)
})

test('lossy JSON corner cases cannot masquerade as identical', () => {
  assert.equal(same(NaN, null), false)
  assert.equal(same({ a: undefined }, {}), false)
  assert.equal(same({ a: NaN }, { a: null }), false)
  assert.equal(same({ a: -0 }, { a: 0 }), false)
  const sparse = Array(2)
  sparse[1] = 'value'
  assert.equal(same(sparse, [undefined, 'value']), false)
  assert.equal(same(new Date('2025-01-01'), new Date('2025-01-02')), false)
  assert.equal(same(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false)
})

test('cycles and custom prototypes fail closed', () => {
  const cycle = { id: 1 }
  cycle.self = cycle
  const second = { id: 1 }
  second.self = second
  assert.equal(same(cycle, second), false)
  class HiddenRow { constructor() { this.id = 1 } }
  assert.equal(same(new HiddenRow(), { id: 1 }), false)
})
