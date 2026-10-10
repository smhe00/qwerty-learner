/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-s2-preflight-'))
const bundle = join(tmp, 'preflight.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v2-preflight.ts')],
  outfile: bundle, bundle: true, platform: 'node', target: 'node20', format: 'esm' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { preflightManualSyncV2 } = await import(pathToFileURL(bundle).href)
const id = 'immutable-owner'
const snapshot = {
  backupFormatVersion: 'qwerty-backup-v4',
  workspaceData: {
    database: { formatName: 'dexie', data: { tables: [], data: [] } },
    settings: { version: 1, values: {} },
    learnRuntime: { dailySessions: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
  },
  metadata: { createdAt: '2026-10-10', source: { kind: 'account', accountId: id } },
}
const absent = { hasData: false, revision: 0, logicalFingerprint: null, clientFormatVersion: null }
const v4 = fingerprint => ({
  hasData: true, revision: 1, logicalFingerprint: fingerprint,
  clientFormatVersion: 'qwerty-backup-v4',
})

test('S2 empty V4 logical snapshot and empty cloud is a transport-free noop', async () => {
  const out = await preflightManualSyncV2(snapshot, id, absent, null)
  assert.equal(out.hasMeaningfulState, false)
  assert.equal(out.decision.action, 'noop')
  assert.equal(out.decision.baselineOnly, true)
})

test('S2 local V4 and identical cloud hash is a metadata-only noop', async () => {
  const first = await preflightManualSyncV2(snapshot, id, absent, null)
  const matching = await preflightManualSyncV2(snapshot, id, v4(first.localFingerprint), null)
  assert.equal(matching.decision.action, 'noop')
})

test('S2 dirty V4 local with remote changed is explicit conflict', async () => {
  const changed = structuredClone(snapshot)
  changed.workspaceData.settings.values.memoryConfig = { blockSize: 1 }
  const first = await preflightManualSyncV2(snapshot, id, absent, null)
  const remote = { ...v4(first.localFingerprint), revision: 7 }
  const baseline = { accountId: id, baseRevision: 1, logicalFingerprint: first.localFingerprint }
  const result = await preflightManualSyncV2(changed, id, remote, baseline)
  assert.equal(result.hasMeaningfulState, true)
  assert.equal(result.decision.action, 'conflict')
})

test('S2 V3 remote without canonical fingerprint cannot authorize ordinary sync', async () => {
  const remote = {
    hasData: true, revision: 1, logicalFingerprint: null, clientFormatVersion: 'qwerty-backup-v3',
  }
  const result = await preflightManualSyncV2(snapshot, id, remote, null)
  assert.equal(result.decision.action, 'blocked')
  assert.equal(result.decision.reason, 'remote-format-unsupported')
})

test('S2 preflight fails closed for different login owner', async () => {
  const result = await preflightManualSyncV2(snapshot, 'different-owner', absent, null)
  assert.equal(result.decision.action, 'blocked')
  assert.equal(result.decision.reason, 'identity-mismatch')
})
