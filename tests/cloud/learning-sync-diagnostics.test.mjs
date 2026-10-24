import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'qwerty-sync-diagnostic-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = join(dir, 'diagnostics.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/learning-sync-diagnostics.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
const { readLearningSyncDiagnostics: read, recordLearningSyncDiagnostic: record } = await import(pathToFileURL(output).href)
const key = 'qwerty.learning-sync-diagnostics.v1'
function storage() {
  const saved = new Map()
  globalThis.sessionStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) }
  return saved
}
test('diagnostics retain fixed field counts but never raw payload, identifiers or unknown codes', () => {
  storage()
  record({
    stage: 'm3-recovery',
    status: 'ready',
    token: 'secret',
    accountId: 'private',
    audit: {
      scanned: 3,
      eligible: 1,
      snapshotOnly: 2,
      rejected: 0,
      rows: ['private'],
      issues: { 'missing-attempt-id': 2, 'private-word': 1 },
    },
  })
  record({ stage: 'm3-publication', status: 'blocked', code: 'secret-account-private' })
  const result = read()
  assert.equal(result.entries[0].audit.issues['missing-attempt-id'], 2)
  assert.equal(result.entries[1].code, 'unknown')
  assert.ok(!/secret|private/.test(JSON.stringify(result)))
})
test('diagnostic reads sanitize persisted input and cap history', () => {
  const saved = storage()
  saved.set(
    key,
    JSON.stringify(
      Array.from({ length: 100 }, () => ({
        stage: 'm4-adoption',
        status: 'candidate',
        retainedLegacyStates: 3,
        private: 'not-exported',
        code: 'm4-prefix-conflicting-local-attempt',
      })),
    ),
  )
  assert.equal(read().entries.length, 64)
  assert.ok(!JSON.stringify(read()).includes('private'))
  assert.equal(read().entries[0].retainedLegacyStates, 3)
  record({ stage: 'm3-publication', status: 'idle' })
  assert.equal(read().entries.length, 64)
})
test('unavailable diagnostic storage cannot interrupt synchronization', () => {
  globalThis.sessionStorage = {
    getItem() {
      throw Error('disabled')
    },
    setItem() {
      throw Error('quota')
    },
  }
  assert.doesNotThrow(() => record({ stage: 'm3-publication', status: 'idle' }))
  assert.deepEqual(read(), { version: 1, entries: [] })
})
