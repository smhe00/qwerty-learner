import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m3-checkout-followup-'))
const bundle = join(dir, 'gate.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/m3-checkout-cycle.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { tryDeclareCheckoutAfterPublication: follow } =
  await import(pathToFileURL(bundle).href)
const accountId = 'account-A'
const deviceId = 'qwerty-web-00000000-0000-4000-8000-000000000010'
const head = { deviceId, sequence: 1,
  batchId: '00000000-0000-4000-8000-000000000011',
  sha256: 'b'.repeat(64) }
const receipt = { deviceId,
  checkoutId: '00000000-0000-4000-8000-000000000012',
  sha256: 'c'.repeat(64) }
const uploaded = { status: 'uploaded-events-only', scanned: 1,
  batches: 1, remaining: 0 }
function fixture(overrides = {}) {
  const calls = []
  const port = {
    async assertOwner() {
      calls.push('owner')
      if (overrides.changedOwner && calls.includes('declare')) {
        throw Error('switched-account')
      }
    },
    async readOutbox() {
      calls.push('outbox')
      return { version: 1, accountId, deviceId, pending: [],
        inflight: null, confirmedHead: head, confirmedEvidence: {},
        ...(overrides.state ?? {}) }
    },
    async declare(request) {
      calls.push('declare')
      assert.deepEqual(request, head)
      return { status: 'declared-checkout-only', receipt,
        cloudRevision: 7, cloudFingerprint: 'f'.repeat(64),
        publishReady: false, convergenceComplete: false,
        ...(overrides.result ?? {}) }
    },
  }
  return { accountId, deviceId, published: uploaded, port, calls }
}
test('new durable chained head declares checkout, never V4 convergence', async () => {
  const input = fixture()
  const result = await follow(input)
  assert.equal(result.status, 'declared-checkout-only')
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.deepEqual(input.calls, ['owner','outbox','owner','declare','owner'])
})
test('no new upload, failed upload or unfinished publishing never sends checkout', async () => {
  for (const published of [
    { status: 'idle', scanned: 0 },
    { status: 'blocked', reason: 'network-offline' },
    { ...uploaded, remaining: 2 },
    { ...uploaded, batches: 0 },
  ]) {
    const input = fixture()
    input.published = published
    const result = await follow(input)
    assert.equal(result.status, 'skipped')
    assert.deepEqual(input.calls, [])
  }
})
test('pending or in-flight durable batches forbid checkout declaration', async () => {
  for (const state of [
    { pending: [{}] }, { inflight: { events: [{}] } },
    { confirmedHead: null }, { deviceId: 'other' },
    { accountId: 'other' }, { version: 99 },
    { confirmedHead: { ...head, deviceId: 'other' } },
  ]) {
    const input = fixture({ state })
    const result = await follow(input)
    assert.equal(result.status, 'blocked')
    assert.equal(input.calls.includes('declare'), false)
  }
})
test('server checkout refusal remains blocked, local event bytes untouched', async () => {
  const input = fixture({ result: { status: 'blocked',
    reason: 'checkout-cloud-version-changed' } })
  const result = await follow(input)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'checkout-cloud-version-changed')
  assert.equal(result.publishReady, false)
})
test('misleading server convergence flag is rejected', async () => {
  const input = fixture({ result: { convergenceComplete: true } })
  const result = await follow(input)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'checkout-misleading-convergence-flag')
})
test('account switch after awaited POST cannot claim declaration', async () => {
  const input = fixture({ changedOwner: true })
  const result = await follow(input)
  assert.equal(result.status, 'blocked')
  assert.match(result.reason, /switched-account/)
})
