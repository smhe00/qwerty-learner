/* eslint-env node */
// Final post-release proof that P4b's temporary test13/test24 backend bypass
// was removed from EdgeOne Maker. Creates and deletes only its own test13.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const base = new URL(process.env.QWERTY_SYNC_BASE_URL ||
  'https://qwerty-plus.edgeone.dev/')
const oldMarker = 'p4b-temporary-named-v4-debug-20261011'
const oldMarkerV1 = 'p4b-temporary-named-write-test-20261011'
const username = 'test13'
const password = crypto.randomBytes(22).toString('base64url')
let token = null
let failure
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function api(path, method = 'GET', body, authorization = token) {
  const headers = { Accept: 'application/json' }
  if (authorization) headers.Authorization = 'Bearer ' + authorization
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(new URL(path, base), { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20000) })
  return { status: res.status, data: await res.json() }
}
function eq(result, status, code, description) {
  assert.equal(result.status, status, description + ': HTTP ' + result.status)
  if (code) assert.equal(result.data?.error, code, description + ': error code')
}
try {
  const deadline = Date.now() + 11 * 60 * 1000
  let published = false
  while (Date.now() < deadline) {
    const status = await api('/api/health').catch(() => ({ status: 503, data: {} }))
    const caps = status.data?.capabilities
    if (status.status === 200 && Array.isArray(caps) &&
        !caps.includes(oldMarker) && !caps.includes(oldMarkerV1)) {
      published = true
      break
    }
    await delay(10000)
  }
  assert.ok(published, 'Strict allowlist Maker build did not become active')
  console.log('P4b strict Maker release marker removed: PASS')

  const registration = await api('/api/auth/register', 'POST', {
    username, password, deviceId: 'p4b-post-release-proof',
  }, '')
  if (registration.status === 201 && registration.data?.token) token = registration.data.token
  eq(registration, 201, null, 'fresh test13 registration')
  assert.ok(token && registration.data?.user?.userId)
  const before = await api('/api/sync/v2/meta')
  eq(before, 200, null, 'before metadata')
  assert.equal(before.data?.revision, 0)

  for (const url of ['/api/sync/v2', '/api/sync/v2/recovery']) {
    const denied = await api(url, 'PUT', { malformed: true })
    eq(denied, 403, 's2_write_not_enabled', url + ' strict deny')
    assert.equal((await api('/api/sync/v2/meta')).data?.revision, 0,
      'rejected named-account write mutated revision')
  }
  console.log('P4b test13 temporary write exception fully removed: PASS')
} catch (err) {
  failure = err
} finally {
  if (token) {
    try {
      const deleted = await api('/api/auth/account', 'DELETE',
        { currentPassword: password })
      eq(deleted, 200, null, 'cleanup test13')
      assert.equal(deleted.data?.deleted?.accountDeleted, true)
      console.log('P4b final verification disposable test13 cleanup: PASS')
    } catch (err) { failure ||= err }
  }
}
if (failure) throw failure
