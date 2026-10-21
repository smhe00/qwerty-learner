import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  issueDeviceCheckoutDeclaration as issue,
  readDeviceCheckoutDeclaration as read,
} from '../../cloud-functions/_shared/device-checkout.js'

const accountId = 'account-immutable-A'
const deviceId = 'qwerty-web-00000000-0000-4000-8000-000000000013'
const otherId = 'qwerty-web-00000000-0000-4000-8000-000000000014'
const head = { deviceId, sequence: 1,
  batchId: '00000000-0000-4000-8000-000000000015',
  sha256: 'b'.repeat(64) }
const session = { accountId, deviceId }
const payload = { cloudRevision: 8, cloudFingerprint: 'c'.repeat(64), eventHead: head }
const key = (a,d,id,s) => [a,d,id,s].join('|')

function ports(opts = {}) {
  const saved = new Map()
  const calls = []
  return { calls, saved,
    port: {
      async verifyExactCloudRevision(a, r, sha) {
        calls.push('revision')
        return a === accountId && r === 8 && sha === payload.cloudFingerprint &&
          !opts.badRevision
      },
      async verifyExactChainedHead(a, receipt) {
        calls.push('head')
        return a === accountId && receipt.batchId === head.batchId && !opts.badHead
      },
      async putImmutable(a, d, id, checksum, record) {
        calls.push('put')
        const k = key(a,d,id,checksum)
        if (!opts.dropWrite) saved.set(k, structuredClone(record))
        return !opts.noAck
      },
      async readExact(a,d,id,checksum) {
        calls.push('read')
        const stored = saved.get(key(a,d,id,checksum))
        if (!stored) return null
        return opts.mutateReadback
          ? { ...stored, cloudRevision: 9 } : structuredClone(stored)
      },
    },
  }
}
test('independent per-device server checkout declaration has content-addressed exact readback', async () => {
  const p = ports()
  const result = await issue(session, payload, p.port)
  assert.equal(result.verifiedExactReceipt, true)
  assert.equal(result.publishReady, false)
  assert.deepEqual(p.calls, ['revision','head','put','read'])
  const detail = await read({ accountId, deviceId: otherId }, result.receipt, p.port)
  assert.equal(detail.cloudRevision, 8)
  assert.equal(detail.cloudFingerprint, payload.cloudFingerprint)
  assert.equal(detail.deviceId, deviceId)
  assert.equal(detail.scope, 'device-declared-checkout-only')
  assert.equal(detail.convergenceComplete, false)
})
test('per-device receipt UUID changes even for identical checkout revisions', async () => {
  const p = ports()
  const a = await issue(session, payload, p.port)
  const b = await issue(session, payload, p.port)
  assert.notEqual(a.receipt.checkoutId, b.receipt.checkoutId)
  assert.equal(p.saved.size, 2)
})
test('missing cloud SHA evidence or mismatched immutable event head cannot issue', async () => {
  const a = ports({ badRevision: true })
  await assert.rejects(issue(session, payload, a.port),
    /checkout-cloud-revision-not-verified/)
  assert.equal(a.saved.size, 0)
  const b = ports({ badHead: true })
  await assert.rejects(issue(session, payload, b.port),
    /checkout-event-head-not-verified/)
  assert.equal(b.saved.size, 0)
})
test('device identifier must be bound to server session before POST', async () => {
  const p = ports()
  await assert.rejects(issue({ accountId, deviceId: otherId }, payload, p.port),
    /checkout-request-invalid/)
  await assert.rejects(issue({ accountId, deviceId: 'untrusted' }, payload, p.port),
    /checkout-authenticated-device-required/)
  assert.equal(p.saved.size, 0)
})
test('failed or altered readback never confirms a checkout', async () => {
  const a = ports({ dropWrite: true })
  await assert.rejects(issue(session, payload, a.port),
    /checkout-receipt-identity-or-content-invalid/)
  const b = ports({ mutateReadback: true })
  await assert.rejects(issue(session, payload, b.port),
    /checkout-immutable-readback-mismatch/)
})
test('ambiguous write acknowledgement may succeed ONLY via identical exact read', async () => {
  const p = ports({ noAck: true })
  assert.equal((await issue(session, payload, p.port)).verifiedExactReceipt, true)
  assert.equal(p.saved.size, 1)
})
test('GET rejects cross-account, forged hash and tampered body', async () => {
  const p = ports()
  const { receipt } = await issue(session, payload, p.port)
  const x = await read({ accountId: 'foreign', deviceId }, receipt, p.port)
  assert.equal(x, null, 'account-specific storage does not disclose other users')
  await assert.rejects(read(session, { ...receipt, sha256: 'invalid' }, p.port),
    /checkout-receipt-selector-invalid/)
  const body = p.saved.get(key(accountId, receipt.deviceId,
    receipt.checkoutId, receipt.sha256))
  body.cloudFingerprint = '1'.repeat(64)
  await assert.rejects(read(session, receipt, p.port),
    /checkout-receipt-content-sha-mismatch/)
})
