/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-recovery-'))
const out = join(tmp, 'recovery.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/multi-device-recovery.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
test.after(() => rmSync(tmp, { recursive: true, force: true }))
const { planOutboxRecovery } = await import(pathToFileURL(out).href)
const uuid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0')
const event = (i, extra = {}) => ({ id: i, attemptId: uuid(i),
  dict: 'school', word: 'alpha', sourceMode: 'learn', chapter: -1,
  timeStamp: 1800000000 + i, timing: [], wrongCount: 0, mistakes: {},
  ...extra })

test('recovery deterministically sorts immutable history regardless of DB row order', () => {
  const first = planOutboxRecovery([event(3), event(1), event(2)])
  const last = planOutboxRecovery([event(1), event(3), event(2)])
  assert.equal(first.status, 'ready')
  assert.deepEqual(first.events, last.events)
  assert.deepEqual(first.events.map(r => r.attemptId),
    [uuid(1), uuid(2), uuid(3)])
  assert.ok(first.events.every(r => r.id === undefined))
})

test('same UUID with differing local DB PK is one learning attempt', () => {
  const r = planOutboxRecovery([event(1), event(1, { id: 123 })])
  assert.equal(r.status, 'ready')
  assert.equal(r.count, 1)
})

test('same UUID conflicting immutable result is blocked without partial plans', () => {
  const r = planOutboxRecovery([event(1), event(1, { wrongCount: 4 })])
  assert.deepEqual(r, { status: 'blocked', reason: 'contradictory-attempt', count: 2 })
})

test('unanchored legacy evidence, invalid timestamps and out-of-bound scan fail closed', () => {
  assert.equal(planOutboxRecovery([event(1, { attemptId: undefined })]).reason,
    'legacy-or-corrupt-attempt')
  assert.equal(planOutboxRecovery([event(1, { timeStamp: NaN })]).reason,
    'legacy-or-corrupt-attempt')
  assert.equal(planOutboxRecovery([event(1), event(2)], 1).reason, 'unbounded-scan')
})

test('empty account workspace has an empty recovery plan', () => {
  const r = planOutboxRecovery([])
  assert.equal(r.status, 'ready')
  assert.deepEqual(r.events, [])
})
