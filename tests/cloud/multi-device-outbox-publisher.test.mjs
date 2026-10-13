/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-m3-publisher-'))
const output = join(tmp, 'publisher.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/multi-device-outbox-publisher.ts')],
  outfile: output, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json'),
})
test.after(() => rmSync(tmp, { recursive: true, force: true }))
const { publishOneImmutableBatch } = await import(pathToFileURL(output).href)
const deviceId = 'qwerty-web-00000000-0000-4000-8000-000000000001'
const batchId = '00000000-0000-4000-8000-000000000002'
const event = { attemptId: '00000000-0000-4000-8000-000000000003',
  dict: 'school', word: 'alpha', timeStamp: 1800000000, chapter: -1,
  sourceMode: 'learn', wrongCount: 0, timing: [], mistakes: {} }
const batch = { deviceId, batchId, sequence: 1, previous: null, events: [event] }
const sha256 = 'a'.repeat(64)
const ack = { deviceId, batchId, sequence: 1, sha256 }

function harness() {
  const s = { version: 1, accountId: 'acc-A', deviceId,
    inflight: structuredClone(batch), pending: [event],
    confirmedEvidence: {}, confirmedHead: null }
  let attempts = 0
  let confirms = 0
  let owner = true
  const port = {
    assertOwner: async () => {
      if (!owner) throw Error('outbox-owner-changed')
    },
    reserve: async () => { attempts++; return s },
    publish: async () => ({ stored: true, ...ack }),
    read: async () => ({ ok: true, batch: {
      ...structuredClone(batch), accountId: 'acc-A',
      schemaVersion: 2, sha256,
    } }),
    confirm: async () => {
      confirms++
      s.pending = []
      s.inflight = null
      return s
    },
  }
  return { port, setOwner: value => { owner = value },
    counts: () => ({ attempts, confirms }) }
}

test('POST+exact GET receipt permits one confirmed deletion only', async () => {
  const h = harness()
  const result = await publishOneImmutableBatch('acc-A', h.port)
  assert.equal(result.status, 'verified')
  assert.deepEqual(h.counts(), { attempts: 1, confirms: 1 })
  assert.equal((await publishOneImmutableBatch('acc-A', h.port)).status, 'idle')
})

test('ambiguous timeout retains original batch for identical retry', async () => {
  const h = harness()
  const original = JSON.stringify(batch)
  h.port.publish = async () => { throw Error('ACK lost after durable POST') }
  const lost = await publishOneImmutableBatch('acc-A', h.port)
  assert.equal(lost.status, 'retained')
  assert.equal(h.counts().confirms, 0)
  assert.equal(JSON.stringify(h.port.reserve().then ? batch : null), original)
  h.port.publish = async () => ({ stored: true, ...ack })
  assert.equal((await publishOneImmutableBatch('acc-A', h.port)).status, 'verified')
  assert.equal(h.counts().confirms, 1)
})

test('forged POST receipt or changed exact readback never confirms', async () => {
  const h = harness()
  h.port.publish = async () => ({ stored: true, ...ack, batchId:
    '00000000-0000-4000-8000-000000000004' })
  assert.equal((await publishOneImmutableBatch('acc-A', h.port)).status, 'retained')
  assert.equal(h.counts().confirms, 0)
  h.port.publish = async () => ({ stored: true, ...ack })
  h.port.read = async () => ({ ok: true, batch: { ...batch,
    accountId: 'acc-B', schemaVersion: 2, sha256 } })
  assert.equal((await publishOneImmutableBatch('acc-A', h.port)).status, 'retained')
  assert.equal(h.counts().confirms, 0)
})

test('account changes while awaiting remote write: never confirm stale owner', async () => {
  const h = harness()
  h.port.publish = async () => {
    h.setOwner(false)
    return { stored: true, ...ack }
  }
  assert.equal((await publishOneImmutableBatch('acc-A', h.port)).status, 'retained')
  assert.equal(h.counts().confirms, 0)
})

test('corrupt or other-owner IDB reservation throws rather than silently retrying', async () => {
  const h = harness()
  h.port.reserve = async () => ({ ...await harness().port.reserve(),
    accountId: 'acc-B' })
  await assert.rejects(publishOneImmutableBatch('acc-A', h.port),
    /outbox-reservation-owner-mismatch/)
})
