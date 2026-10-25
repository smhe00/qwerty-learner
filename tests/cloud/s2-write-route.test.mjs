/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { retrySafeBodyRequest } from '../../cloud-functions/_shared/safe-body-retry.js'

// Actual EdgeOne route integration with mocked account service/storage.
// Backend V4 content/ownership/CAS contracts are tested independently.
const calls = []
const source = fileURLToPath(new URL('../../cloud-functions/api/[[default]].js', import.meta.url))
const result = await build({ entryPoints: [source], bundle: true, write: false,
  format: 'esm', platform: 'node', target: 'node20', plugins: [{
    name: 'mock-edgeone', setup(build) {
      const mocked = new Set([
        '@edgeone/pages-blob', '../_shared/core.js',
        '../_shared/auth-rate-limit.js', '../_shared/storage/edgeone-blob.js', '../_shared/administrator.js',
      ])
      build.onResolve({ filter: /.*/ }, args =>
        mocked.has(args.path) ? { path: args.path, namespace: 'p4b-mock' } : undefined)
      build.onLoad({ filter: /.*/, namespace: 'p4b-mock' }, args => {
        const name = args.path
        if (name === '@edgeone/pages-blob') return { contents: 'export const getStore = () => ({})', loader: 'js' }
        if (name.includes('administrator')) return { contents: 'export const loadAdministrator = async () => ({userId: "", credentials: undefined, isAdministrator: () => false})', loader: 'js' }
        if (name.includes('auth-rate-limit')) return { contents: 'export const checkAuthRateLimit = async () => ({ allowed: true })', loader: 'js' }
        if (name.includes('edgeone-blob')) return { contents: 'export const withRetry = operation => operation(); export const createEdgeOneBlobStorage = () => ({})', loader: 'js' }
        return { contents: `export class AppError extends Error {
            constructor(statusCode, code, message, details) {
              super(message); this.statusCode=statusCode; this.code=code; this.details=details
            }
          }
          export const createBackendService = () => ({
            me: async token => {
              globalThis.__p4bCalls.push('auth')
              if (token === 'expired' || token === 'revoked' || token === 'unrecognized') {
                throw new AppError(401, 'invalid_session', 'Invalid session')
              }
              if (token !== 'token-a' && token !== 'token-b') {
                throw new AppError(401, 'invalid_session', 'Invalid session')
              }
              return { user: { userId: token === 'token-a' ? 'id-a' : 'id-b' } }
            },
            login: async () => { globalThis.__p4bCalls.push('login'); return { token: 'synthetic-token' } },
            register: async () => { globalThis.__p4bCalls.push('register'); return { token: 'synthetic-token' } },
            putSyncV4: async () => { globalThis.__p4bCalls.push('v4'); return { revision: 1 } },
            putSyncV4Recovery: async () => { globalThis.__p4bCalls.push('recovery'); return { revision: 2 } },
            putSync: async () => { globalThis.__p4bCalls.push('v1'); return { revision: 3 } },
          })`, loader: 'js' }
      })
    }
  }] })
globalThis.__p4bCalls = calls
const { onRequest } = await import('data:text/javascript;base64,' +
  Buffer.from(result.outputFiles[0].text).toString('base64'))
async function request(path, token, env = {}, body = '{}', method = 'PUT') {
  calls.length = 0
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const response = await onRequest({ env,
    request: new Request('https://qwerty-plus.edgeone.dev/api' + path, {
      method, headers, body,
    }) })
  return { status: response.status, data: await response.json(), calls: [...calls] }
}

for (const path of ['/sync/v2', '/sync/v2/recovery']) {
  const verb = path.endsWith('recovery') ? 'recovery' : 'v4'
  test(path + ' permits EVERY valid immutable account without any configured allowlist', async () => {
    for (const token of ['token-a', 'token-b']) {
      for (const env of [
        {},
        { S2_SYNC_WRITE_ACCOUNT_IDS: '' },
        { S2_SYNC_WRITE_ACCOUNT_IDS: 'id-a' },
        { S2_SYNC_WRITE_ACCOUNT_IDS: '*' },
      ]) {
        const actual = await request(path, token, env)
        assert.equal(actual.status, 200)
        assert.deepEqual(actual.calls, ['auth', verb])
      }
    }
  })

  test(path + ' refuses missing/invalid/revoked/expired session BEFORE parsing payload', async () => {
    for (const token of [null, 'unrecognized', 'expired', 'revoked']) {
      const actual = await request(path, token, {}, '{invalid-json')
      assert.equal(actual.status, 401)
      assert.equal(actual.data.error, token === null ? 'missing_token' : 'invalid_session')
      assert.ok(!actual.calls.includes(verb))
    }
  })

  test(path + ' supports emergency global suspension but never an ID allowlist', async () => {
    const actual = await request(path, 'token-a', { S2_SYNC_WRITES_DISABLED: 'true' })
    assert.equal(actual.status, 503)
    assert.equal(actual.data.error, 's2_writes_temporarily_disabled')
    assert.deepEqual(actual.calls, ['auth'])
  })

  test(path + ' rejects malformed JSON before invoking backend write', async () => {
    const actual = await request(path, 'token-b', {}, '{invalid-json')
    assert.equal(actual.status, 400)
    assert.equal(actual.data.error, 'invalid_json')
    assert.deepEqual(actual.calls, ['auth'])
  })
}

test('retired legacy PUT refuses writes without contacting backend storage', async () => {
  const actual = await request('/sync', 'token-a')
  assert.equal(actual.status, 410)
  assert.equal(actual.data.error, 'legacy_sync_retired')
  assert.deepEqual(actual.calls, [])
})

test('account deletion keeps an unavailable Circle safety check RED with only a fixed stage', async () => {
  // The mock's short account ID fails the real Circle activity validation.
  // This must never become permission to delete or disclose provider errors.
  const actual = await request('/auth/account', 'token-a', {}, '{}', 'DELETE')
  assert.equal(actual.status, 500)
  assert.equal(actual.data.error, 'account_delete_unavailable')
  assert.deepEqual(actual.data.details, { stage: 'circle-activity' })
  assert.deepEqual(actual.calls, ['auth'])
  assert.ok(!JSON.stringify(actual.data).includes('id-a'))
})


test('unreadable auth body is proven pre-business and exposes no private exception text', async () => {
  const request = new Request('https://qwerty-plus.edgeone.dev/api/auth/login', { method: 'POST', body: '{}' })
  calls.length = 0
  request.arrayBuffer = async () => { throw new Error('DO_NOT_EXPOSE_PASSWORD_OR_PRIVATE_KEY') }
  const response = await onRequest({ request, uuid: 'eolog-synthetic-123', clientIp: '127.0.0.1' })
  const data = await response.json()
  assert.equal(response.status, 503)
  assert.equal(data.error, 'request_body_unavailable')
  assert.deepEqual(data.details, { stage: 'request-body', safeToRetry: true })
  assert.deepEqual(calls, [])
  assert.equal(data.requestId, 'eolog-synthetic-123')
  assert.ok(!JSON.stringify(data).includes('DO_NOT_EXPOSE'))
})


test('auth accepts native bytes even when the platform text helper is broken', async () => {
  calls.length = 0
  const request = new Request('https://qwerty-plus.edgeone.dev/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'learner', password: 'synthetic' }) })
  request.text = async () => { throw new Error('broken compatibility text helper') }
  const response = await onRequest({ request, clientIp: '127.0.0.1' })
  assert.equal(response.status, 200)
  assert.deepEqual(calls, ['login'])
})

for (const [label, body, headers, status] of [
  ['malformed JSON', '{broken', {}, 400],
  ['invalid UTF8', new Uint8Array([0xff, 0xfe]), {}, 400],
  ['declared oversize', '{}', { 'Content-Length': '9999999' }, 413],
  ['length mismatch', '{}', { 'Content-Length': '3' }, 400],
]) test('auth rejects ' + label + ' before calling account business logic', async () => {
  calls.length = 0
  const response = await onRequest({ clientIp: '127.0.0.1', request: new Request('https://qwerty-plus.edgeone.dev/api/auth/register',
    { method: 'POST', headers, body }) })
  assert.equal(response.status, status)
  assert.deepEqual(calls, [])
})

test('one pre-business body rejection plus one fresh transport request registers exactly once', async () => {
  calls.length = 0
  let sent = 0
  const input = JSON.stringify({ username: 'synthetic-learner', password: 'synthetic-password' })
  const result = await retrySafeBodyRequest(async () => {
    const request = new Request('https://qwerty-plus.edgeone.dev/api/auth/register', { method: 'POST', body: input })
    if (++sent === 1) request.arrayBuffer = async () => { throw new TypeError('receiver unavailable') }
    const response = await onRequest({ request, clientIp: '127.0.0.1' })
    return { status: response.status, body: await response.json() }
  }, { path: '/api/auth/register', method: 'POST', pause: async () => undefined })
  assert.equal(result.status, 201)
  assert.equal(sent, 2)
  assert.deepEqual(calls, ['register'])
})
