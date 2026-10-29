/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-outbox-'))
const out = join(tmp, 'outbox.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/multi-device-outbox.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
test.after(() => rmSync(tmp, { recursive: true, force: true }))
const { initialEventOutbox, stageOutboxAttempts, reserveOutboxBatch,
  acknowledgeOutboxBatch, rememberVerifiedRemoteAttempts } = await import(pathToFileURL(out).href)
const uuid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0')
const device = i => 'qwerty-web-' + uuid(i)
const record = i => ({ id: i, attemptId: uuid(i), dict: 'school',
  word: 'w' + i, timeStamp: 1800000000 + i, chapter: -1, timing: [],
  sourceMode: 'learn', learnItemKind: 'review', wrongCount: 0, mistakes: {},
  fsrsShadow: { sourceRecordId: i }, reviewPolicyShadow: { random: true } })
const receipt = (batch, sha256 = 'a'.repeat(64)) => ({
  deviceId: batch.deviceId, sequence: batch.sequence,
  batchId: batch.batchId, sha256,
})

test('reliable uncertain-response retry, reboot and exact receipt advancement', () => {
  let s = initialEventOutbox('account-A', device(1))
  s = stageOutboxAttempts(s, [record(1), record(2), record(1)])
  assert.equal(s.pending.length, 2)
  assert.ok(s.pending.every(row => row.id === undefined && !row.fsrsShadow))
  s = reserveOutboxBatch(s, uuid(21))
  assert.equal(s.inflight.sequence, 1)
  assert.equal(s.inflight.previous, null)
  const persisted = JSON.parse(JSON.stringify(s))
  // Network POST may have committed remotely; timeout must retain SAME bytes.
  assert.deepEqual(reserveOutboxBatch(persisted, uuid(999)), persisted)
  assert.throws(() => acknowledgeOutboxBatch(persisted,
    { ...receipt(s.inflight), sha256: 'invalid' }), /receipt-does-not-match/)
  assert.equal(persisted.pending.length, 2)
  s = acknowledgeOutboxBatch(persisted, receipt(s.inflight))
  assert.equal(s.pending.length, 0)
  assert.equal(s.confirmedHead.sequence, 1)
  s = stageOutboxAttempts(s, [record(3)])
  s = reserveOutboxBatch(s, uuid(22))
  assert.deepEqual(s.inflight.previous, {
    batchId: uuid(21), sha256: 'a'.repeat(64) })
  assert.equal(s.inflight.sequence, 2)
})

test('different account/device queues are isolated; numeric Dexie IDs do not identify events', () => {
  const a = stageOutboxAttempts(initialEventOutbox('A', device(1)), [record(1)])
  const b = stageOutboxAttempts(initialEventOutbox('B', device(2)),
    [{ ...record(2), id: 1 }])
  assert.notEqual(a.deviceId, b.deviceId)
  assert.notEqual(a.pending[0].attemptId, b.pending[0].attemptId)
  assert.equal(a.pending.length, 1)
  assert.equal(b.pending.length, 1)
})

test('staging the same UUID with contradictory immutable evidence fails closed', () => {
  const s = stageOutboxAttempts(initialEventOutbox('A', device(1)), [record(1)])
  assert.throws(() => stageOutboxAttempts(s, [
    { ...record(1), wrongCount: 3 },
  ]), /outbox-contradictory-attempt/)
  assert.equal(s.pending.length, 1)
})

test('in-flight batch cannot be accidentally changed by newer queued evidence', () => {
  let state = stageOutboxAttempts(initialEventOutbox('A', device(1)),
    [record(1)])
  state = reserveOutboxBatch(state, uuid(32))
  const serialized = JSON.stringify(state.inflight)
  state = stageOutboxAttempts(state, [record(2)])
  assert.equal(JSON.stringify(state.inflight), serialized)
  assert.equal(state.pending.length, 2)
  assert.throws(() => acknowledgeOutboxBatch(state,
    { ...receipt(state.inflight), batchId: uuid(45) }), /receipt-does-not-match/)
  const acked = acknowledgeOutboxBatch(state, receipt(state.inflight))
  assert.equal(acked.pending.length, 1)
  assert.equal(acked.pending[0].attemptId, uuid(2))
})

test('invalid and oversized immutable attempts are never silently discarded', () => {
  const empty = initialEventOutbox('A', device(1))
  assert.throws(() => stageOutboxAttempts(empty, [
    { ...record(1), attemptId: 'not-uuid' },
  ]), /invalid-immutable-attempt/)
  const large = { ...record(3), timing: Array.from({ length: 50_000 }, () => 123) }
  const queued = stageOutboxAttempts(empty, [large])
  assert.throws(() => reserveOutboxBatch(queued, uuid(35)), /attempt-too-large/)
  assert.equal(queued.pending.length, 1)
})
test('repeated full-history rescan does not resend a verified UUID', () => {
  let state = stageOutboxAttempts(initialEventOutbox('A', device(1)),
    [record(1), record(2)])
  state = reserveOutboxBatch(state, uuid(50))
  state = acknowledgeOutboxBatch(state, receipt(state.inflight))
  assert.equal(Object.keys(state.confirmedEvidence).length, 2)
  const recovered = JSON.parse(JSON.stringify(state))
  const rescan = stageOutboxAttempts(recovered, [
    { ...record(1), id: 1234, fsrsShadow: { sourceRecordId: 1234 } },
    { ...record(2), id: 5678 },
    record(3),
  ])
  assert.equal(rescan.pending.length, 1)
  assert.equal(rescan.pending[0].attemptId, uuid(3))
  assert.throws(() => stageOutboxAttempts(rescan, [
    { ...record(1), word: 'contradictory' },
  ]), /outbox-contradictory-attempt/)
})
test('outbox never allows damaged queued evidence to shadow acknowledged UUID', () => {
  let state = stageOutboxAttempts(initialEventOutbox('A', device(1)), [record(1)])
  state = reserveOutboxBatch(state, uuid(80))
  state = acknowledgeOutboxBatch(state, receipt(state.inflight))
  const tampered = {
    ...state, pending: [{ ...record(1), id: undefined, fsrsShadow: undefined,
      reviewPolicyShadow: undefined, wrongCount: 5 }],
  }
  assert.throws(() => stageOutboxAttempts(tampered, [record(2)]),
    /outbox-corrupt-confirmed-evidence/)
  assert.equal(state.pending.length, 0)
})


test('verified adopted events survive serialization without an echo upload or a forged local head', () => {
  let state = rememberVerifiedRemoteAttempts(initialEventOutbox('A', device(1)), [record(2)])
  state = stageOutboxAttempts(JSON.parse(JSON.stringify(state)), [record(2), record(2)])
  assert.equal(state.pending.length, 0)
  assert.equal(reserveOutboxBatch(state, uuid(100)).inflight, null)
  assert.equal(state.confirmedHead, null)
  // A new local event still forms the first genuine device publication.
  state = reserveOutboxBatch(stageOutboxAttempts(state, [record(3)]), uuid(101))
  assert.equal(state.inflight.sequence, 1)
  assert.deepEqual(state.inflight.events.map(row => row.attemptId), [uuid(3)])
})

test('remote confirmation prunes only matching unreserved rows and never an ambiguous in-flight batch', () => {
  let state = reserveOutboxBatch(stageOutboxAttempts(initialEventOutbox('A', device(1)), [record(1)]), uuid(102))
  state = stageOutboxAttempts(state, [record(2), record(3)])
  const bytes = JSON.stringify(state.inflight)
  state = rememberVerifiedRemoteAttempts(state, [record(1), record(2)])
  assert.equal(JSON.stringify(state.inflight), bytes)
  assert.deepEqual(state.pending.map(row => row.attemptId), [uuid(1), uuid(3)])
  assert.equal(state.confirmedHead, null)
  // The original exact readback remains required and can finish normally.
  state = acknowledgeOutboxBatch(state, receipt(state.inflight))
  assert.deepEqual(state.pending.map(row => row.attemptId), [uuid(3)])
  assert.equal(state.confirmedHead.sequence, 1)
})

test('conflicting remote evidence cannot partially prune or acknowledge a local queue', () => {
  const original = stageOutboxAttempts(initialEventOutbox('A', device(1)), [record(1), record(2)])
  const bytes = JSON.stringify(original)
  assert.throws(() => rememberVerifiedRemoteAttempts(original, [record(1), { ...record(2), wrongCount: 8 }]), /contradictory/)
  assert.equal(JSON.stringify(original), bytes)
  assert.throws(() => rememberVerifiedRemoteAttempts(original, [{ ...record(3), attemptId: 'bad' }]), /invalid/)
  assert.equal(JSON.stringify(original), bytes)
})

test('remote confirmation remains account/device scoped and rejects later changed raw evidence', () => {
  const a = rememberVerifiedRemoteAttempts(initialEventOutbox('A', device(1)), [record(1)])
  assert.throws(() => stageOutboxAttempts(a, [{ ...record(1), word: 'changed' }]), /contradictory/)
  assert.equal(stageOutboxAttempts(initialEventOutbox('B', device(1)), [record(1)]).pending.length, 1)
  assert.equal(stageOutboxAttempts(initialEventOutbox('A', device(2)), [record(1)]).pending.length, 1)
})
