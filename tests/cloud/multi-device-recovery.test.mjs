/* eslint-env node */
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-recovery-'))
const out = join(tmp, 'recovery.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/multi-device-recovery.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json'),
})
test.after(() => rmSync(tmp, { recursive: true, force: true }))
const { planOutboxRecovery } = await import(pathToFileURL(out).href)
const uuid = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0')
const event = (i, extra = {}) => ({
  id: i,
  attemptId: uuid(i),
  dict: 'school',
  word: 'alpha',
  sourceMode: 'learn',
  chapter: -1,
  timeStamp: 1800000000 + i,
  timing: [],
  wrongCount: 0,
  mistakes: {},
  ...extra,
})

test('recovery deterministically sorts immutable history regardless of DB row order', () => {
  const first = planOutboxRecovery([event(3), event(1), event(2)])
  const last = planOutboxRecovery([event(1), event(3), event(2)])
  assert.equal(first.status, 'ready')
  assert.deepEqual(first.events, last.events)
  assert.deepEqual(
    first.events.map((r) => r.attemptId),
    [uuid(1), uuid(2), uuid(3)],
  )
  assert.ok(first.events.every((r) => r.id === undefined))
})

test('same UUID with differing local DB PK is one learning attempt', () => {
  const r = planOutboxRecovery([event(1), event(1, { id: 123 })])
  assert.equal(r.status, 'ready')
  assert.equal(r.count, 1)
})

test('same UUID conflicting immutable result is blocked without partial plans', () => {
  const r = planOutboxRecovery([event(1), event(1, { wrongCount: 4 })])
  assert.equal(r.status, 'blocked')
  assert.equal(r.reason, 'contradictory-attempt')
  assert.equal(r.count, 2)
  assert.ok(!('events' in r))
})

test('missing historical UUID and provenance are preserved as snapshot-only, never fabricated events', () => {
  const records = [
    event(1, { attemptId: undefined }),
    event(2, { sourceMode: undefined }),
    event(3, { attemptId: undefined, sourceMode: undefined }),
    event(4),
  ]
  const original = structuredClone(records)
  const result = planOutboxRecovery(records)
  assert.equal(result.status, 'ready')
  assert.deepEqual(
    result.events.map((r) => r.attemptId),
    [uuid(4)],
  )
  assert.deepEqual(result.audit, {
    scanned: 4,
    eligible: 1,
    snapshotOnly: 3,
    rejected: 0,
    issues: { 'missing-attempt-id': 2, 'missing-source-mode': 2 },
  })
  assert.deepEqual(records, original)
  assert.deepEqual(planOutboxRecovery(records), result, 'unchanged relogin is deterministic')
})
test('invalid present identity, provenance, time and out-of-bound scan still fail closed', () => {
  for (const extra of [
    { attemptId: 'invalid' },
    { attemptId: null },
    { sourceMode: 'guessed' },
    { timeStamp: NaN },
    { dict: '' },
    { word: '' },
    { reviewBaseStateFingerprint: 'invalid' },
  ]) {
    const result = planOutboxRecovery([event(1, extra), event(2)])
    assert.equal(result.status, 'blocked')
    assert.equal(result.reason, 'invalid-attempt')
    assert.equal(result.audit.rejected, 1)
    assert.ok(!('events' in result))
  }
  assert.equal(planOutboxRecovery([event(1), event(2)], 1).reason, 'unbounded-scan')
})
test('historical missing provenance cannot disguise a conflicting known UUID', () => {
  const result = planOutboxRecovery([event(1, { sourceMode: undefined }), event(1)])
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'contradictory-attempt')
})

test('empty account workspace has an empty recovery plan', () => {
  const r = planOutboxRecovery([])
  assert.equal(r.status, 'ready')
  assert.deepEqual(r.events, [])
})
