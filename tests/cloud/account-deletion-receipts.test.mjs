/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountDeletionReceipts } from '../../cloud-functions/_shared/account-deletion-receipts.js'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { build } from 'esbuild'

function fixture() {
  const blobs = new Map()
  const store = {
    async get(key) { return structuredClone(blobs.get(key) ?? null) },
    async setJSON(key, value) { blobs.set(key, structuredClone(value)) },
    async delete(key) { blobs.delete(key) },
    async list({ prefix, limit = 1000, cursor = '' }) {
      const keys = [...blobs.keys()].filter(key => key.startsWith(prefix)).sort(), offset = Number(cursor || 0)
      return { blobs: keys.slice(offset, offset + limit).map(key => ({ key })),
        cursor: offset + limit < keys.length ? String(offset + limit) : '' }
    },
  }
  return { blobs, store }
}
const token = 'synthetic-session-'.repeat(5), operationId = '1'.repeat(32)
const identity = { userId: 'a'.repeat(32), usernameHash: 'b'.repeat(64) }

test('receipt survives complete account erasure; wrong bearer/operation never discovers it', async () => {
  const f = fixture(), receipts = createAccountDeletionReceipts(f)
  const started = await receipts.begin(token, operationId, identity)
  assert.equal((await receipts.status(token, operationId)).state, 'pending')
  await assert.rejects(receipts.status(token + 'wrong', operationId), { code: 'deletion_receipt_not_found' })
  await assert.rejects(receipts.status(token, '2'.repeat(32)), { code: 'deletion_receipt_not_found' })
  await receipts.complete(started, { accountDeleted: true })
  assert.equal((await receipts.status(token, operationId)).state, 'completed')
  assert.ok(!JSON.stringify([...f.blobs]).includes(token), 'no raw bearer in stored receipts')
  await assert.rejects(receipts.begin(token, operationId, identity), { code: 'deletion_already_started' })
})

test('receipt write acknowledgement loss is verified once; invisible write cannot authorize deletion', async () => {
  const f = fixture(), original = f.store.setJSON
  let writes = 0
  f.store.setJSON = async (...args) => { writes++; await original(...args); throw Error('response lost') }
  const receipts = createAccountDeletionReceipts(f)
  await receipts.begin(token, operationId, identity)
  assert.equal(writes, 1)
  f.store.setJSON = async () => { writes++; throw Error('before write') }
  await assert.rejects(receipts.begin(token, '2'.repeat(32), identity), { code: 'deletion_receipt_unverified' })
  assert.equal(writes, 2)
})

test('pending, corrupt, missing and expired outcomes are never completed', async () => {
  const f = fixture(); let clock = 1000
  const receipts = createAccountDeletionReceipts({ ...f, now: () => clock })
  const started = await receipts.begin(token, operationId, identity)
  await assert.rejects(receipts.complete(started, { accountDeleted: false }), { code: 'deletion_incomplete' })
  f.blobs.set(started.key + 'completed.json', { version: 1, startedHash: 'forged', completedAt: clock, deleted: { accountDeleted: true } })
  await assert.rejects(receipts.status(token, operationId), { code: 'deletion_receipt_invalid' })
  clock += 24 * 60 * 60 * 1000
  await assert.rejects(receipts.status(token, operationId), { code: 'deletion_receipt_expired' })
})

test('wrong password and protected administrator never run receipt or deletion hook', async () => {
  const f = fixture(), storage = createEdgeOneBlobStorage(f.store)
  const service = createBackendService({ storage })
  const signed = await service.register('deletion_hook', 'synthetic-password', 'test')
  let hooks = 0
  await assert.rejects(service.deleteAccount(signed.token, 'wrong', { beforeDelete: () => { hooks++ } }), { code: 'invalid_credentials' })
  const protectedService = createBackendService({ storage, credentials: { accepts: () => true, matches: () => true } })
  await assert.rejects(protectedService.deleteAccount(signed.token, 'synthetic-password', { beforeDelete: () => { hooks++ } }), { code: 'administrator_protected' })
  assert.equal(hooks, 0)
})

test('real gateway: in-flight and dropped DELETE response settle with original-bearer read-only receipt', async () => {
  const f = fixture(); globalThis.__deletionReceiptStore = f.store
  const built = await build({ entryPoints: ['cloud-functions/api/[[default]].js'], bundle: true,
    platform: 'node', target: 'node20', format: 'esm', write: false, plugins: [{ name: 'receipt-store', setup(b) {
      b.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'store', namespace: 'receipt' }))
      b.onLoad({ filter: /.*/, namespace: 'receipt' }, () => ({ contents: 'export const getStore = () => globalThis.__deletionReceiptStore', loader: 'js' }))
    } }] })
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  let ip = 0
  const call = async (path, method, body, bearer) => {
    const response = await onRequest({ env: { branch: 'etest', ADMIN_PASSWORD: 'synthetic-only', IDLE_CLEANUP_EXECUTE: 'false' },
      clientIp: '192.0.2.' + (++ip), request: new Request('https://example.test/api' + path, {
        method, headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const signed = await call('/auth/register', 'POST', { username: 'e2e_delete_receipt', password: 'synthetic-password' })
    assert.equal(signed.status, 201)
    const owner = signed.body.user.userId, bearer = signed.body.token
    const contentKey = 'users/' + owner + '/feedback/v1/thread/root.json'
    f.blobs.set(contentKey, { text: 'synthetic' })
    let unblock, entered
    const blocked = new Promise(resolve => { unblock = resolve })
    const deleting = new Promise(resolve => { entered = resolve })
    const originalDelete = f.store.delete
    f.store.delete = async key => { if (key === contentKey) { entered(); await blocked } await originalDelete(key) }
    const removal = call('/auth/account', 'DELETE', { currentPassword: 'synthetic-password', operationId }, bearer)
    await deleting
    const pending = await call('/auth/account/deletion-status?operationId=' + operationId, 'GET', null, bearer)
    assert.equal(pending.status, 200); assert.equal(pending.body.state, 'pending')
    // Reproduce the previous CI race: a fresh login while DELETE is still busy
    // is itself removed by the original cleanup. It cannot prove failure/success.
    const overlapping = await call('/auth/login', 'POST', { username: 'e2e_delete_receipt', password: 'synthetic-password' })
    assert.equal(overlapping.status, 200)
    unblock()
    // Simulate a response lost after the real mutation; do not authenticate again.
    assert.equal((await removal).status, 200)
    assert.equal((await call('/auth/me', 'GET', null, bearer)).status, 401)
    assert.equal((await call('/auth/me', 'GET', null, overlapping.body.token)).status, 401)
    const outcome = await call('/auth/account/deletion-status?operationId=' + operationId, 'GET', null, bearer)
    assert.equal(outcome.status, 200); assert.equal(outcome.body.state, 'completed')
    assert.equal(outcome.body.userId, owner)
    assert.equal([...f.blobs.keys()].some(k => k.startsWith('users/' + owner + '/')), false)
    assert.equal((await call('/auth/account/deletion-status?operationId=' + operationId, 'GET', null, token)).status, 404)
    const admin = await call('/auth/login', 'POST', { username: 'admin', password: 'synthetic-only' })
    assert.equal((await call('/auth/account', 'DELETE', { currentPassword: 'synthetic-only', operationId: '3'.repeat(32) }, admin.body.token)).status, 403)
    assert.equal((await call('/auth/account/deletion-status?operationId=' + '3'.repeat(32), 'GET', null, admin.body.token)).status, 404)
  } finally { delete globalThis.__deletionReceiptStore }
})
