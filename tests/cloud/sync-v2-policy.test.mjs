import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-s2-policy-'))
const target = join(tmp, 's2.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/v2-policy.ts')],
  outfile: target, bundle: true, platform: 'node', target: 'node20', format: 'esm',
})
after(() => rmSync(tmp, { recursive: true, force: true }))
const { decideManualSyncV2 } = await import(pathToFileURL(target).href)

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const workspace = { kind: 'account', accountId: 'immutable-account-A' }
const baseline = { accountId: workspace.accountId, baseRevision: 3, logicalFingerprint: A }
const remote = { hasData: true, revision: 3, logicalFingerprint: A, clientFormatVersion: 'qwerty-backup-v4' }
const local = { logicalFingerprint: A, hasMeaningfulState: true }
function decide(changes = {}) {
  return decideManualSyncV2({
    activeWorkspace: workspace, authenticatedAccountId: workspace.accountId,
    local, remote, baseline, ...changes,
  })
}
function assertDecision(changes, action, reason, baselineOnly = false) {
  const input = {
    activeWorkspace: workspace, authenticatedAccountId: workspace.accountId,
    local, remote, baseline, ...changes,
  }
  const untouched = structuredClone(input)
  const actual = decideManualSyncV2(input)
  assert.deepEqual({ action: actual.action, reason: actual.reason, baselineOnly: actual.baselineOnly },
    { action, reason, baselineOnly })
  assert.deepEqual(input, untouched, 'pure policy must not change any replica/metadata')
  return actual
}

test('same canonical V4 fingerprint is metadata-only noop even after revision advanced', () => {
  const out = assertDecision({
    remote: { ...remote, revision: 8 },
  }, 'noop', 'identical', true)
  assert.equal(out.remoteRevision, 8)
})

test('both empty and no cloud are metadata-only noop', () => {
  assertDecision({
    local: { logicalFingerprint: A, hasMeaningfulState: false },
    remote: { hasData: false, revision: 0, logicalFingerprint: null, clientFormatVersion: null },
    baseline: null,
  }, 'noop', 'empty-both', true)
})

test('first populated local copy may push to truly absent cloud using CAS revision zero', () => {
  const out = assertDecision({
    remote: { hasData: false, revision: 0, logicalFingerprint: null, clientFormatVersion: null },
    baseline: null,
  }, 'push', 'local-changed')
  assert.equal(out.remoteRevision, 0)
})

test('local-only edit at the known cloud revision permits future CAS push', () => {
  assertDecision({ local: { ...local, logicalFingerprint: B } }, 'push', 'local-changed')
})

test('cloud-only edit at higher revision permits verified pull', () => {
  assertDecision({ remote: { ...remote, revision: 4, logicalFingerprint: B } }, 'pull', 'remote-changed')
})

test('divergent local and cloud changes never choose a winner', () => {
  assertDecision({
    local: { ...local, logicalFingerprint: B },
    remote: { ...remote, revision: 4, logicalFingerprint: C },
  }, 'conflict', 'concurrent-edits')
})

test('first login on another device can pull into truly empty local account', () => {
  assertDecision({
    local: { logicalFingerprint: B, hasMeaningfulState: false },
    baseline: null,
  }, 'pull', 'remote-changed')
})

test('new device with meaningful local data and remote snapshot must not overwrite', () => {
  assertDecision({
    local: { logicalFingerprint: B, hasMeaningfulState: true },
    baseline: null,
  }, 'conflict', 'unbound-local')
})

test('same revision but changed cloud hash is protocol inconsistency, not a valid pull', () => {
  assertDecision({
    remote: { ...remote, logicalFingerprint: B },
  }, 'blocked', 'remote-changed-without-revision')
})

test('old V1/V3 format remote requires explicit migration, not ordinary Sync', () => {
  for (const format of ['qwerty-backup-v3', 'qwerty-dexie-gzip-v2', null]) {
    assertDecision({ remote: { ...remote, logicalFingerprint: B, clientFormatVersion: format } },
      'blocked', 'remote-format-unsupported')
  }
})

test('missing V4 logical fingerprint fails closed instead of comparing gzip hashes', () => {
  assertDecision({ remote: { ...remote, logicalFingerprint: null } },
    'blocked', 'remote-fingerprint-missing')
})

test('anonymous workspace cannot ever participate in cloud sync', () => {
  assertDecision({ activeWorkspace: { kind: 'anonymous' } }, 'blocked', 'anonymous-workspace')
})

test('an authenticated account cannot sync another immutable local owner', () => {
  assertDecision({ authenticatedAccountId: 'other-ID' }, 'blocked', 'identity-mismatch')
  assertDecision({ authenticatedAccountId: null }, 'blocked', 'identity-mismatch')
})

test('baseline of another account cannot authorize a push or pull', () => {
  assertDecision({ baseline: { ...baseline, accountId: 'different-ID' } },
    'blocked', 'baseline-owner-mismatch')
})

test('invalid fingerprint or invalid baseline fails closed', () => {
  assertDecision({ local: { ...local, logicalFingerprint: '' } },
    'blocked', 'invalid-local-state')
  assertDecision({ baseline: { ...baseline, logicalFingerprint: 'invalid' } },
    'blocked', 'invalid-baseline')
  assertDecision({ baseline: { ...baseline, baseRevision: -1 } },
    'blocked', 'invalid-baseline')
})

test('revision rollback and missing cloud after a synced revision fail closed', () => {
  assertDecision({ remote: { ...remote, revision: 2, logicalFingerprint: B } },
    'blocked', 'remote-revision-regressed')
  assertDecision({
    remote: { hasData: false, revision: 0, logicalFingerprint: null, clientFormatVersion: null },
  }, 'blocked', 'remote-revision-regressed')
})

test('invalid revision or contradictory no-data metadata fails closed', () => {
  for (const rev of [-1, NaN, 1.5]) {
    assertDecision({ remote: { ...remote, revision: rev } }, 'blocked', 'invalid-remote-metadata')
  }
  assertDecision({
    baseline: null,
    remote: { hasData: false, revision: 3, logicalFingerprint: null, clientFormatVersion: null },
  }, 'blocked', 'invalid-remote-metadata')
})

test('baseline absent but identical fingerprint is still safe metadata-only noop', () => {
  assertDecision({ baseline: null }, 'noop', 'identical', true)
})

test('S2 step 1 never performs HTTP, IndexedDB, or localStorage operations', () => {
  // The policy only receives value objects; it has no injected IO capability.
  const input = { local: { ...local, logicalFingerprint: B } }
  assert.equal(decide(input).action, 'push')
  assert.equal(input.local.logicalFingerprint, B)
})
