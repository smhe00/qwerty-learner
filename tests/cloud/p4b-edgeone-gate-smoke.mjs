/* eslint-env node */
// P4b production smoke: disposable account only. No Blob admin credentials.
// This proves the deployed API fails closed for an unlisted account, without
// modifying any existing account. Explicit cleanup is mandatory.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'

const origin = (process.env.QWERTY_SYNC_BASE_URL ||
  'https://qwerty-plus.edgeone.dev/').trim()
const base = new URL(origin)
const username = 'p4b_gate_' + Date.now().toString(36) +
  crypto.randomBytes(4).toString('hex')
const password = crypto.randomBytes(18).toString('base64url')
let token
let created = false
let failure

async function api(path, method = 'GET', body, auth = token) {
  const headers = { Accept: 'application/json' }
  if (auth) headers.Authorization = 'Bearer ' + auth
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, base), {
    method, headers, body: body === undefined ? undefined :
      (typeof body === 'string' ? body : JSON.stringify(body)),
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  const value = await response.json().catch(() => null)
  return { status: response.status, value }
}
function expectCode(result, status, code, label) {
  assert.equal(result.status, status,
    label + ': unexpected HTTP status (' + result.status + ')')
  if (code) assert.equal(result.value?.error, code, label + ': error code')
}
try {
  const health = await api('/api/health')
  assert.equal(health.status, 200, 'EdgeOne gateway health')
  assert.equal(health.value?.service, 'qwerty-sync-gateway')
  console.log('P4b health: PASS')

  const unauthorized = await api('/api/sync/v2', 'PUT', '{}', '')
  expectCode(unauthorized, 401, 'missing_token', 'unauthenticated V2 PUT')
  console.log('P4b anonymous V2 PUT rejection: PASS')

  const registered = await api('/api/auth/register', 'POST', {
    username, password, deviceId: 'p4b-isolated-ci',
  }, '')
  expectCode(registered, 201, null, 'disposable register')
  assert.ok(registered.value?.user?.userId, 'disposable immutable userId')
  assert.ok(registered.value?.token, 'disposable token')
  token = registered.value.token
  created = true

  const before = await api('/api/sync/v2/meta')
  assert.equal(before.status, 200, 'read V2 meta before gate test')
  assert.equal(before.value?.revision, 0, 'new test account revision 0')
  for (const endpoint of ['/api/sync/v2', '/api/sync/v2/recovery']) {
    // Malformed JSON proves authorization precedes request body parsing.
    const denied = await api(endpoint, 'PUT', '{not-json')
    expectCode(denied, 403, 's2_write_not_enabled', endpoint)
    const afterDenied = await api('/api/sync/v2/meta')
    assert.equal(afterDenied.status, 200)
    assert.equal(afterDenied.value?.revision, before.value.revision,
      endpoint + ': revision mutated by rejected write')
  }
  console.log('P4b V2 + recovery fail-closed, no mutation: PASS')

  const payloadBase64 = gzipSync(Buffer.from(JSON.stringify({
    format: 'p4b-disposable-v1-smoke', nonce: Date.now(),
  }))).toString('base64')
  const legacy = await api('/api/sync', 'PUT', {
    baseRevision: 0, payloadBase64, deviceId: 'p4b-isolated-ci',
    clientFormatVersion: 'qwerty-backup-v3',
  })
  assert.equal(legacy.status, 200,
    'legacy V1 PUT response ' + legacy.status)
  assert.equal(legacy.value?.revision, 1)
  const afterLegacy = await api('/api/sync/meta')
  assert.equal(afterLegacy.status, 200)
  assert.equal(afterLegacy.value?.revision, 1)
  assert.equal(afterLegacy.value?.clientFormatVersion, 'qwerty-backup-v3')
  console.log('P4b legacy V1 write + revision: PASS')

  const deniedAfterLegacy = await api('/api/sync/v2', 'PUT', '{not-json')
  expectCode(deniedAfterLegacy, 403, 's2_write_not_enabled',
    'V2 write gate after legacy V1 data')
  const finalMeta = await api('/api/sync/v2/meta')
  assert.equal(finalMeta.value?.revision, 1)
  console.log('P4b V1 data protected from unlisted V2 write: PASS')
} catch (error) {
  failure = error
} finally {
  if (created && token) {
    try {
      const removed = await api('/api/auth/account', 'DELETE',
        { currentPassword: password })
      assert.equal(removed.status, 200, 'disposable account cleanup')
      assert.equal(removed.value?.deleted?.accountDeleted, true,
        'disposable account cleanup confirmation')
      console.log('P4b disposable account cleanup: PASS')
    } catch (error) {
      console.error('P4b isolated account cleanup FAILED: ', error.message)
      failure = failure || error
    }
  }
}
if (failure) throw failure
