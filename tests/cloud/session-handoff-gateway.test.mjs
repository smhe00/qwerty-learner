/* eslint-env node */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { PausableBlob, fixture } from './session-handoff-fixtures.mjs'

let directory, gatewayUrl, onRequest
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'handoff-gateway-'))
  const outfile = join(directory, 'gateway.mjs')
  await build({ entryPoints: ['cloud-functions/api/[[default]].js'], outfile,
    bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', plugins: [{
      name: 'synthetic-blob-only', setup(builder) {
        builder.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'blob', namespace: 'test-io' }))
        builder.onLoad({ filter: /.*/, namespace: 'test-io' }, () => ({
          contents: 'export const getStore = options => globalThis.__handoffGatewayTestStore(options)',
          loader: 'js',
        }))
      },
    }] })
  gatewayUrl = pathToFileURL(outfile).href
  ;({ onRequest } = await import(gatewayUrl))
})
after(async () => { delete globalThis.__handoffGatewayTestStore; await rm(directory, { recursive: true, force: true }) })
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const wait = async predicate => {
  for (let i = 0; i < 1000; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.fail('gateway state not observed')
}
let ipNumber = 0
async function harness({ ordinary = false, unclonableAuth = false } = {}) {
  // A new fake Blob service represents a fresh deployment. Reset module-scoped
  // SDK transports as well; real stores do not change behind the same client.
  onRequest = (await import(gatewayUrl + '?fixture=' + crypto.randomUUID())).onRequest
  const authReadCounts = []
  const stores = new Map()
  globalThis.__handoffGatewayTestStore = options => {
    const name = typeof options === 'string' ? options : options.name
    if (!stores.has(name)) stores.set(name, new PausableBlob())
    return stores.get(name)
  }
  const username = (ordinary ? 'plain' : 'qh26') + crypto.randomBytes(12).toString('hex')
  const password = crypto.randomBytes(18).toString('hex'), clientIp = `192.0.2.${++ipNumber}`
  async function call(path, { method = 'GET', token, body, bytes, headers = {}, env = {} } = {}) {
    const request = new Request('https://internal-maker.invalid/api' + path, { method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(bytes ? { body: bytes } : body ? { body: JSON.stringify(body) } : {}) })
    if (unclonableAuth && ['/auth/register', '/auth/login'].includes(path)) {
      const receive = request.arrayBuffer.bind(request)
      const count = { reads: 0 }
      authReadCounts.push(count)
      request.clone = () => { throw new Error('runtime clone unavailable') }
      request.arrayBuffer = async () => {
        if (++count.reads !== 1) throw new Error('body consumed twice')
        return receive()
      }
    }
    const result = await onRequest({ request, clientIp, env: { branch: 'etest', AUTH_RATE_LIMIT_REQUESTS: '1000', ...env } })
    const data = (result.headers.get('content-type') || '').includes('json') ? await result.json() : null
    return { status: result.status, data, headers: result.headers }
  }
  const register = await call('/auth/register', { method: 'POST', body: { username, password, deviceId: 'A' } })
  assert.equal(register.status, 201, JSON.stringify(register.data))
  const login = () => call('/auth/login', { method: 'POST', body: { username, password, deviceId: 'B' } })
  const direct = (token, input, headers = {}) => call('/sync/v2/binary/direct', { method: 'POST', token,
    bytes: input.payloadBytes, headers: { 'Content-Type': 'application/octet-stream',
      'X-Qwerty-Base-Revision': String(input.baseRevision),
      'X-Qwerty-Logical-Fingerprint': input.logicalFingerprint,
      'X-Qwerty-Payload-Sha256': sha(input.payloadBytes),
      'X-Qwerty-Device-Id': input.deviceId, ...headers } })
  return { stores, call, register, login, direct, username, password, authReadCounts,
    blob: stores.get('qwerty-data'), first: register.data }
}

test('actual HTTP gateway: A manifest drains before B login and revoked requests cannot write', { timeout: 10000 }, async () => {
  const h = await harness(), pause = h.blob.armManifestPause()
  const input = fixture(h.first.user.userId, 'alpha')
  const a = h.direct(h.first.token, input)
  await pause.reached.promise
  let loginReturned = false
  const b = h.login().then(result => { loginReturned = true; return result })
  try {
    await wait(async () => (await h.call('/auth/handoff/status', { token: h.first.token })).data?.pendingHandoffs === 1)
    assert.equal(loginReturned, false)
    const refused = await h.direct(h.first.token, input)
    assert.equal(refused.status, 409); assert.equal(refused.data.error, 'handoff_draining')
  } finally { pause.release.resolve() }
  const [uploaded, second] = await Promise.all([a, b])
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data))
  assert.equal(second.status, 200, JSON.stringify(second.data))
  assert.equal(second.headers.get('x-qwerty-handoff'), 'account-handoff-blob-fixtures-v1')
  const meta = await h.call('/sync/v2/meta', { token: second.data.token })
  assert.equal(meta.data.revision, 1); assert.equal(meta.data.dataSha256, sha(input.payloadBytes))
  const late = await h.direct(h.first.token, fixture(h.first.user.userId, 'late', 1))
  assert.equal(late.status, 401)
  assert.equal((await h.call('/sync/v2/meta', { token: second.data.token })).data.dataSha256, sha(input.payloadBytes))
})

test('actual HTTP gateway: invalid credentials never close admission', { timeout: 10000 }, async () => {
  const h = await harness()
  const before = (await h.call('/auth/handoff/status', { token: h.first.token })).data.operations
  const bad = await h.call('/auth/login', { method: 'POST', body: { username: h.username, password: 'wrong' } })
  assert.equal(bad.status, 401)
  assert.equal((await h.call('/auth/handoff/status', { token: h.first.token })).data.operations, before)
})

test('actual HTTP gateway: rate limiting is still applied to wrong fixture passwords', { timeout: 10000 }, async () => {
  const h = await harness()
  const bad = await h.call('/auth/login', { method: 'POST', env: { branch: 'etest', AUTH_RATE_LIMIT_REQUESTS: '1' },
    body: { username: h.username, password: 'wrong' } })
  assert.equal(bad.status, 429)
})

test('actual HTTP gateway: explicit logout revokes the single session after draining', { timeout: 10000 }, async () => {
  const h = await harness(), pause = h.blob.armManifestPause()
  const a = h.direct(h.first.token, fixture(h.first.user.userId, 'alpha'))
  await pause.reached.promise
  const logout = h.call('/auth/logout', { method: 'POST', token: h.first.token })
  try { await wait(async () => (await h.call('/auth/handoff/status', { token: h.first.token })).data?.pendingHandoffs === 1) }
  finally { pause.release.resolve() }
  const [uploaded, out] = await Promise.all([a, logout])
  assert.equal(uploaded.status, 200); assert.equal(out.status, 200)
  assert.equal((await h.call('/auth/me', { token: h.first.token })).status, 401)
  const second = await h.login(); assert.equal(second.status, 200)
  assert.equal((await h.call('/sync/v2/meta', { token: second.data.token })).data.revision, 1)
})

test('actual HTTP gateway: multipart staging participates in the same drain, not just core methods', { timeout: 10000 }, async () => {
  const h = await harness()
  const input = fixture(h.first.user.userId, 'part')
  const bytes = input.payloadBytes, hash = sha(bytes)
  const part = await h.call('/sync/v2/parts', { method: 'POST', token: h.first.token, bytes,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Qwerty-Part-Index': '0',
      'X-Qwerty-Part-Count': '1', 'X-Qwerty-Chunk-Bytes': String(512 * 1024),
      'X-Qwerty-Payload-Sha256': hash, 'X-Qwerty-Part-Sha256': hash } })
  assert.equal(part.status, 200, JSON.stringify(part.data))
  assert.equal(part.headers.get('x-qwerty-handoff'), 'account-handoff-blob-fixtures-v1')
  const second = await h.login(); assert.equal(second.status, 200)
  const late = await h.call('/sync/v2/commit', { method: 'POST', token: h.first.token, body: {
    ...input, payloadBytes: undefined, payloadSha256: hash, partSha256s: [hash], count: 1, wirePartBytes: 512 * 1024,
  } })
  assert.equal(late.status, 401)
  assert.equal((await h.call('/sync/v2/meta', { token: second.data.token })).data.revision, 0)
})

test('actual HTTP gateway: existing ordinary accounts are not silently enrolled', { timeout: 10000 }, async () => {
  const h = await harness({ ordinary: true })
  assert.equal(h.register.headers.get('x-qwerty-handoff'), null)
  assert.equal(h.stores.has('qwerty-handoff-qualification'), false)
  assert.equal((await h.login()).status, 200)
})

test('actual HTTP gateway: fixture global/circle routes and active cleanup are rejected', { timeout: 10000 }, async () => {
  const h = await harness()
  for (const path of ['/circle/v2', '/maintenance/idle', '/admin/idle']) {
    assert.equal((await h.call(path, { method: 'POST', token: h.first.token, body: {} })).status, 403)
  }
  const result = await h.call('/sync/v2/meta', { token: h.first.token, env: { IDLE_CLEANUP_EXECUTE: 'true' } })
  assert.equal(result.status, 503)
})

test('actual HTTP gateway: health is explicit about qualification-only coverage', { timeout: 10000 }, async () => {
  const h = await harness()
  const health = await h.call('/health')
  assert.equal(health.data.handoffProductionReady, false)
  assert.equal(health.data.handoffMode, 'reserved-disposable-accounts-only')
  assert.ok(health.data.capabilities.includes('account-handoff-blob-fixtures-v1'))
})


test('live qualification script exercises the complete actual-handler journey locally', { timeout: 15000 }, async () => {
  onRequest = (await import(gatewayUrl + '?fixture=' + crypto.randomUUID())).onRequest
  const stores = new Map()
  globalThis.__handoffGatewayTestStore = options => {
    const name = typeof options === 'string' ? options : options.name
    if (!stores.has(name)) stores.set(name, new PausableBlob())
    return stores.get(name)
  }
  const originalFetch = globalThis.fetch
  const originalExitCode = process.exitCode
  globalThis.fetch = async (input, options) => onRequest({
    request: new Request(input, options), clientIp: '192.0.2.199', env: { branch: 'etest', AUTH_RATE_LIMIT_REQUESTS: '1000' },
  })
  try {
    await import('./session-handoff-live.mjs?local-handler-qualification')
    assert.equal(process.exitCode, originalExitCode, 'live script must pass against the actual protected handler')
  } finally { globalThis.fetch = originalFetch; process.exitCode = originalExitCode }
})


test('actual HTTP gateway: an unreadable classification body cannot bypass the guard', { timeout: 10000 }, async () => {
  const h = await harness()
  const request = new Request('https://internal-maker.invalid/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: h.username, password: h.password, deviceId: 'B' }),
  })
  let reads = 0
  const nativeRead = request.arrayBuffer.bind(request)
  request.arrayBuffer = async () => {
    if (++reads === 1) throw new Error('transient read failure')
    return nativeRead()
  }
  const result = await onRequest({ request, clientIp: '192.0.2.200', env: { branch: 'etest' } })
  assert.equal(result.status, 503)
  const failure = await result.json()
  assert.equal(failure.error, 'request_body_unavailable')
  assert.deepEqual(failure.details, { stage: 'request-body', safeToRetry: true })
  assert.equal(reads, 1)
  // A hypothetical second receive would succeed, but must never bypass the guard.
  assert.equal((await h.call('/auth/me', { token: h.first.token })).status, 200)
})


test('actual gateway: unreadable clone is irrelevant and each auth body is received once', { timeout: 10000 }, async () => {
  for (const ordinary of [false, true]) {
    const h = await harness({ ordinary, unclonableAuth: true })
    const second = await h.login()
    assert.equal(second.status, 200, JSON.stringify(second.data))
    assert.equal(h.register.headers.get('x-qwerty-handoff'), ordinary ? null : 'account-handoff-blob-fixtures-v1')
    assert.deepEqual(h.authReadCounts.map(count => count.reads), [1, 1])
    assert.equal((await h.call('/auth/me', { token: second.data.token })).status, 200)
  }
})

test('actual gateway: auth length mismatch cannot enter admission or revoke A', { timeout: 10000 }, async () => {
  const h = await harness()
  const before = (await h.call('/auth/handoff/status', { token: h.first.token })).data.operations
  const result = await h.call('/auth/login', { method: 'POST',
    headers: { 'Content-Length': '1' }, body: { username: h.username, password: h.password } })
  assert.equal(result.status, 400)
  assert.equal(result.data.error, 'invalid_json')
  assert.equal((await h.call('/auth/handoff/status', { token: h.first.token })).data.operations, before)
  assert.equal((await h.call('/auth/me', { token: h.first.token })).status, 200)
})
