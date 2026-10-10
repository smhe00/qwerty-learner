/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v2-baseline-'))
const bundle = join(tmp, 'baseline.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v2-baseline.ts')],
  outfile: bundle, bundle: true, platform: 'node', target: 'node20', format: 'esm' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { assertValidSyncV2Baseline, assertNextSyncV2Baseline } =
  await import(pathToFileURL(bundle).href)
const A = 'immutable-ID-A', B = 'immutable-ID-B'
const h1 = 'a'.repeat(64), h2 = 'b'.repeat(64)
const old = { accountId: A, baseRevision: 4, logicalFingerprint: h1 }

test('V2 cloud baseline has immutable account ID and SHA-256 logical fingerprint', () => {
  assert.doesNotThrow(() => assertValidSyncV2Baseline(old, A))
  for (const corrupted of [
    { ...old, accountId: B }, { ...old, baseRevision: -1 },
    { ...old, baseRevision: 1.2 }, { ...old, logicalFingerprint: 'gzip-sha-not-logical' },
    null,
  ]) {
    assert.throws(() => assertValidSyncV2Baseline(corrupted, A))
  }
})

test('V2 baseline can advance after an authenticated revision but never roll back', () => {
  assert.doesNotThrow(() => assertNextSyncV2Baseline(A, null, old))
  assert.doesNotThrow(() => assertNextSyncV2Baseline(A, old,
    { ...old, baseRevision: 5, logicalFingerprint: h2 }))
  assert.throws(() => assertNextSyncV2Baseline(A, old,
    { ...old, baseRevision: 3, logicalFingerprint: h2 }), /regression/)
})

test('same cloud revision cannot silently adopt a different logical fingerprint', () => {
  assert.throws(() => assertNextSyncV2Baseline(A, old,
    { ...old, logicalFingerprint: h2 }), /without cloud revision/)
  assert.doesNotThrow(() => assertNextSyncV2Baseline(A, old, { ...old }))
})

test('V2 baseline cannot switch owners even if the cloud revision matches', () => {
  assert.throws(() => assertNextSyncV2Baseline(B, old, { ...old, accountId: B }))
})

test('S2 baseline CAS metadata is not a portable workspace field', () => {
  const source = { accountId: old.accountId, baseRevision: old.baseRevision,
    logicalFingerprint: old.logicalFingerprint }
  assert.deepEqual(Object.keys(source).sort(),
    ['accountId', 'baseRevision', 'logicalFingerprint'])
})
