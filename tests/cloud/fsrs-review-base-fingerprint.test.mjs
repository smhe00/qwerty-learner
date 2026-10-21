import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-fsrs-base-'))
const out = join(tmp, 'fingerprint.mjs')
await build({ entryPoints: [resolve(root, 'src/review/fsrs/state-fingerprint.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { fingerprintReviewBaseState: fingerprint } =
  await import(pathToFileURL(out).href)
function state() {
  return {
    id: 101, dict: 'shanghai', word: 'apple',
    createdAt: 1700000000, updatedAt: 1700086400,
    lastReviewedAt: 1700086400, nextReviewAt: 1700172800,
    reviewCount: 2, lapseCount: 1, cleanStreak: 1, lifecycle: 'active',
    stateVersion: 5, schedulerState: {
      kind: 'fsrs6', difficulty: 5.22, stability: 6.92,
      parameterSetId: 'fsrs6-active',
    },
  }
}
test('actual pre-probe FSRS state has stable cross-device SHA independent of Dexie numeric ID', async () => {
  const a = state()
  const b = { ...a, id: 999 }
  const digest = await fingerprint(a)
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.equal(await fingerprint(b), digest)
  assert.equal(await fingerprint(a), digest)
})
test('changed FSRS review count, state, due or word means a different round', async () => {
  const a = state()
  const digest = await fingerprint(a)
  for (const modified of [
    { ...a, reviewCount: 3 },
    { ...a, nextReviewAt: a.nextReviewAt + 60 },
    { ...a, dict: 'other' },
    { ...a, word: 'banana' },
    { ...a, schedulerState: { ...a.schedulerState, stability: 9.4 } },
  ]) {
    assert.notEqual(await fingerprint(modified), digest)
  }
})
test('unverified Basic-v2, excluded FSRS, or missing state never fabricates a base digest', async () => {
  assert.equal(await fingerprint(undefined), null)
  assert.equal(await fingerprint({ ...state(),
    schedulerState: { kind: 'basic-v2', stage: 2, intervalDays: 1 } }), null)
  assert.equal(await fingerprint({ ...state(), lifecycle: 'excluded' }), null)
  assert.equal(await fingerprint({ ...state(),
    exclusion: { reason: 'manual', excludedAt: 1800000000 } }), null)
})
