import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m2-checkout-declare-'))
const bundle = join(dir, 'checkout.mjs')
const workspace = join(dir, 'v4.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/m2-checkout-declaration.ts')],
    outfile: bundle, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: workspace, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { recursive: true, force: true }))
const { declarePinnedDeviceCheckout: declare } =
  await import(pathToFileURL(bundle).href)
const { workspaceFingerprintV4: fingerprint } =
  await import(pathToFileURL(workspace).href)

const accountId = 'account-A'
const deviceId = 'qwerty-web-00000000-0000-4000-8000-000000000010'
const head = { deviceId, sequence: 2,
  batchId: '00000000-0000-4000-8000-000000000011',
  sha256: 'b'.repeat(64) }
const receipt = { deviceId,
  checkoutId: '00000000-0000-4000-8000-000000000012',
  sha256: 'c'.repeat(64) }
const tables = ['wordRecords','chapterRecords','reviewRecords',
  'reviewWordStates','achievementEvents','achievementStates']
const snap = () => ({
  backupFormatVersion: 'qwerty-backup-v4',
  metadata: { createdAt: '2026-10-22T00:00:00Z',
    source: { kind: 'account', accountId } },
  workspaceData: {
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6,
      tables: tables.map(name => ({ name, schema: '++id' })),
      data: tables.map(tableName => ({ tableName, inbound: true, rows: [] })),
    } },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'school', currentChapter: 0 },
  },
})
async function fixture(overrides = {}) {
  const snapshot = snap()
  const hash = await fingerprint(snapshot)
  const pin = { status: 'pinned-local-s2-pull-only', accountId,
    revision: 7, fingerprint: hash, snapshot, publishReady: false,
    convergenceComplete: false }
  const calls = []
  const port = {
    async assertOwner() {
      calls.push('owner')
      if (overrides.changedOwner && calls.includes('declare')) {
        throw Error('owner-changed')
      }
    },
    async readPinnedAncestor() {
      calls.push('pin')
      return overrides.noPin ? null : pin
    },
    async readCloudMeta() {
      calls.push('meta')
      return { hasData: true, revision: 7,
        logicalFingerprint: hash,
        clientFormatVersion: 'qwerty-backup-v4',
        ...(overrides.cloud ?? {}) }
    },
    async verifyEventHead(value) {
      calls.push('verify')
      assert.deepEqual(value, head)
      return { ok: true, verified: true, publishReady: false,
        convergenceComplete: false, listingIsAuthoritative: false,
        ...(overrides.witness ?? {}) }
    },
    async declare(value) {
      calls.push('declare')
      assert.deepEqual(value, { cloudRevision: 7, cloudFingerprint: hash,
        eventHead: head })
      if (overrides.failPost) throw Error('timeout-after-post')
      return { ok: true, verifiedExactReceipt: true,
        publishReady: false, convergenceComplete: false, receipt,
        ...(overrides.post ?? {}) }
    },
    async readExact(selector) {
      calls.push('read')
      assert.deepEqual(selector, receipt)
      return { ok: true, verifiedExactReceipt: true,
        publishReady: false, convergenceComplete: false,
        scope: 'device-declared-checkout-only', accountId, deviceId,
        cloudRevision: 7, cloudFingerprint: hash, eventHead: head,
        ...(overrides.readback ?? {}) }
    },
  }
  return { accountId, deviceId, eventHead: head, port, calls, pin }
}
test('exact account/device S2 pin + M3 event head + immutable readback yields declaration ONLY', async () => {
  const input = await fixture()
  const result = await declare(input)
  assert.equal(result.status, 'declared-checkout-only', result.reason)
  assert.deepEqual(result.receipt, receipt)
  assert.equal(result.cloudRevision, 7)
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.deepEqual(input.calls.filter(c => c !== 'owner'),
    ['pin','meta','verify','declare','read'])
})
test('absent S2 Pull pin, forged current device or head fail before POST', async () => {
  const absent = await fixture({ noPin: true })
  assert.equal((await declare(absent)).reason, 'checkout-no-verified-local-s2-pull')
  assert.equal(absent.calls.includes('declare'), false)
  const foreign = await fixture()
  foreign.eventHead = { ...head, deviceId: 'foreign' }
  assert.equal((await declare(foreign)).reason,
    'checkout-local-identity-or-head-invalid')
  assert.deepEqual(foreign.calls, [])
})
test('locally modified archived V4 must block even with matching claimed SHA', async () => {
  const input = await fixture()
  input.pin.snapshot.workspaceData.navigation.currentChapter = 88
  assert.equal((await declare(input)).reason, 'checkout-local-ancestor-corrupt')
  assert.equal(input.calls.includes('meta'), false)
})
test('cloud revision, hash or format drift blocks declaration instead of masking fork', async () => {
  for (const cloud of [
    { revision: 8 }, { logicalFingerprint: 'd'.repeat(64) },
    { hasData: false }, { clientFormatVersion: 'qwerty-backup-v3' },
  ]) {
    const input = await fixture({ cloud })
    assert.equal((await declare(input)).reason, 'checkout-cloud-version-changed')
    assert.equal(input.calls.includes('declare'), false)
  }
})
test('a non-authoritative or rejected event-chain head never issues checkout', async () => {
  for (const witness of [
    { verified: false }, { listingIsAuthoritative: true },
    { publishReady: true }, { convergenceComplete: true },
  ]) {
    const input = await fixture({ witness })
    assert.equal((await declare(input)).reason, 'checkout-event-head-unverified')
    assert.equal(input.calls.includes('declare'), false)
  }
})
test('server receipt shape and exact GET account/revision/head must all match', async () => {
  const invalid = await fixture({ post: { verifiedExactReceipt: false } })
  assert.equal((await declare(invalid)).reason,
    'checkout-server-declaration-unverified')
  assert.equal(invalid.calls.includes('read'), false)
  for (const readback of [
    { accountId: 'another' }, { cloudRevision: 8 },
    { cloudFingerprint: 'e'.repeat(64) },
    { eventHead: { ...head, sequence: 3 } },
    { scope: 'synced-all-devices' }, { convergenceComplete: true },
  ]) {
    const input = await fixture({ readback })
    assert.equal((await declare(input)).reason, 'checkout-exact-readback-unverified')
  }
})
test('bearer / registry switch after server POST never returns verified checkout', async () => {
  const input = await fixture({ changedOwner: true })
  const result = await declare(input)
  assert.equal(result.status, 'blocked')
  assert.match(result.reason, /checkout-verification-failed:owner-changed/)
  assert.equal(input.calls.includes('read'), false)
})
test('ambiguous POST error does not invent a success or change local V4', async () => {
  const input = await fixture({ failPost: true })
  const before = structuredClone(input.pin.snapshot)
  const result = await declare(input)
  assert.equal(result.status, 'blocked')
  assert.match(result.reason, /timeout-after-post/)
  assert.deepEqual(input.pin.snapshot, before)
  assert.equal(input.calls.includes('read'), false)
})
