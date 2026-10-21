import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-two-device-checkout-'))
const bundle = join(dir, 'gate.mjs')
const workspace = join(dir, 'ws.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/m2-two-device-ancestor.ts')],
    outfile: bundle, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: workspace, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { recursive: true, force: true }))
const { inspectTwoDevicePinnedAncestor: inspect } =
  await import(pathToFileURL(bundle).href)
const { workspaceFingerprintV4: fingerprint } =
  await import(pathToFileURL(workspace).href)

const accountId = 'school-account'
const localDeviceId = 'qwerty-web-00000000-0000-4000-8000-000000000010'
const remoteDeviceId = 'qwerty-web-00000000-0000-4000-8000-000000000011'
const head = { deviceId: remoteDeviceId, sequence: 3,
  batchId: '00000000-0000-4000-8000-000000000012',
  sha256: 'c'.repeat(64) }
const names = ['wordRecords','chapterRecords','reviewRecords',
  'reviewWordStates','achievementEvents','achievementStates']
const snap = word => ({
  backupFormatVersion: 'qwerty-backup-v4',
  metadata: { createdAt: '2026-10-22T00:00:00Z',
    source: { kind: 'account', accountId } },
  workspaceData: {
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6,
      tables: names.map(name => ({ name, schema: '++id' })),
      data: names.map(tableName => ({ tableName, inbound: true,
        rows: tableName === 'wordRecords' ? [{ id: 1, word }] : [] })),
    } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'school', currentChapter: 0 },
  },
})
async function fixture(options = {}) {
  const ancestor = snap('initial')
  const sha = await fingerprint(ancestor)
  const pin = { status: 'pinned-local-s2-pull-only', publishReady: false,
    convergenceComplete: false, accountId, revision: 7, fingerprint: sha,
    snapshot: ancestor }
  const remoteWitness = { accountId, deviceId: remoteDeviceId,
    cloudRevision: 7, cloudFingerprint: sha, eventHead: head }
  const calls = []
  const verifier = {
    async assertOwner() {
      calls.push('owner')
      if (options.ownerChanged) throw Error('account changed')
    },
    async verifyRemoteCheckout(requested) {
      calls.push('checkout')
      assert.equal(requested, remoteDeviceId)
      if (options.noCheckout) return null
      return { ...remoteWitness, ...options.witness }
    },
    async verifyEventHead(receipt) {
      calls.push('head')
      assert.equal(receipt.deviceId, remoteDeviceId)
      return !options.badHead
    },
  }
  return {
    accountId, localDeviceId, remoteDeviceId, localPin: pin,
    local: ancestor, remote: snap('remote'), verifier, calls,
  }
}
test('two distinct checkout identities and exact witnessed head produce read-only V4 candidate', async () => {
  const input = await fixture()
  const result = await inspect(input)
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.equal(result.ancestorRevision, 7)
  assert.equal(result.fastForward.selected, 'remote')
  assert.equal(result.fastForward.publishReady, false)
  assert.deepEqual(input.calls, ['owner','owner','checkout','owner','head','owner','owner'])
})
test('same client device, missing pin or absent checkout cannot simulate independence', async () => {
  const a = await fixture()
  a.remoteDeviceId = a.localDeviceId
  assert.equal((await inspect(a)).reason, 'two-witness-invalid-owner-or-device')
  assert.deepEqual(a.calls, [])
  const b = await fixture()
  b.localPin = null
  assert.equal((await inspect(b)).reason, 'two-witness-local-checkout-not-pinned')
  const c = await fixture({ noCheckout: true })
  assert.equal((await inspect(c)).reason, 'two-witness-independent-checkout-unverified')
})
test('revision mismatch, fingerprint mismatch, forged owner and head mismatch block', async () => {
  for (const witness of [
    { cloudRevision: 8 },
    { cloudFingerprint: 'b'.repeat(64) },
    { accountId: 'foreign' },
    { deviceId: localDeviceId },
    { eventHead: { ...head, deviceId: localDeviceId } },
    { eventHead: { ...head, sequence: 0 } },
    { eventHead: { ...head, sha256: 'not-sha' } },
  ]) {
    const input = await fixture({ witness })
    assert.equal((await inspect(input)).reason,
      'two-witness-independent-checkout-unverified')
  }
})
test('witnessed prefix must pass its own authenticated event-chain verification', async () => {
  const input = await fixture({ badHead: true })
  assert.equal((await inspect(input)).reason, 'two-witness-event-prefix-unverified')
})
test('account switch during awaited verification always returns blocked', async () => {
  const input = await fixture({ ownerChanged: true })
  assert.match((await inspect(input)).reason, /^two-witness-verification-failed/)
})
test('tampered local checkout bytes are never repaired by a matching remote claim', async () => {
  const input = await fixture()
  input.localPin.snapshot.workspaceData.navigation.currentChapter = 16
  assert.equal((await inspect(input)).reason, 'two-witness-local-archive-corrupt')
})
test('two divergent device heads require six-table arbitration despite same ancestor', async () => {
  const input = await fixture()
  input.local = snap('local')
  const result = await inspect(input)
  assert.equal(result.reason,
    'two-witness-v4:disjoint-v4-invalid:disjoint-local-ancestor-record-rewritten')
  assert.equal(result.publishReady, false)
})
test('returned evidence is detached from verifier receipt input', async () => {
  const input = await fixture()
  const result = await inspect(input)
  assert.equal(result.status, 'projected')
  result.remoteHead.sequence = 42
  assert.equal(head.sequence, 3)
})

test('validated two-device ancestor routes independent words to complete V4 disjoint candidate', async () => {
  const input = await fixture()
  const base = structuredClone(input.localPin.snapshot)
  base.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows[0] = {
    id: 1, dict: 'school', word: 'initial', chapter: 0,
    attemptId: '00000000-0000-4000-8000-000000000101',
    timeStamp: 1800000000, timing: [], wrongCount: 0,
    mistakes: {}, sourceMode: 'learn', learnItemKind: 'acquisition',
  }
  const pinned = await fingerprint(base)
  input.localPin.snapshot = base
  input.localPin.fingerprint = pinned
  const oldVerify = input.verifier.verifyRemoteCheckout
  input.verifier.verifyRemoteCheckout = async deviceId => {
    const receipt = await oldVerify(deviceId)
    return { ...receipt, cloudFingerprint: pinned }
  }
  input.local = structuredClone(base)
  input.remote = structuredClone(base)
  const get = s => s.workspaceData.database.data.data.find(
    x => x.tableName === 'wordRecords').rows
  get(input.local).push({ ...get(input.local)[0], id: 2, word: 'banana',
    attemptId: '00000000-0000-4000-8000-000000000102' })
  get(input.remote).push({ ...get(input.remote)[0], id: 2, word: 'cherry',
    attemptId: '00000000-0000-4000-8000-000000000103' })
  const outcome = await inspect(input)
  assert.equal(outcome.status, 'projected', outcome.reason)
  assert.equal(outcome.reason, 'two-witness-disjoint-word-preview-only')
  assert.equal(outcome.publishReady, false)
  assert.equal(outcome.disjoint.candidateFingerprint,
    await fingerprint(outcome.disjoint.candidate))
  assert.deepEqual(get(outcome.disjoint.candidate).map(r => r.word),
    ['initial','banana','cherry'])
  assert.deepEqual(get(outcome.disjoint.candidate).map(r => r.id), [1,2,3])
  assert.equal(outcome.disjoint.requiresFullFsrsAndCloudAdmission,true)
})
test('missing remote checkout witness rejects disjoint merge before processing snapshots', async () => {
  const input = await fixture({ noCheckout: true })
  input.local = snap('local')
  input.remote = snap('remote')
  assert.equal((await inspect(input)).reason,
    'two-witness-independent-checkout-unverified')
})
