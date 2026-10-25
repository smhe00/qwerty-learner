/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runtimeEnvironment } from '../../cloud-functions/_shared/runtime-environment.js'

const built = await build({ entryPoints: ['cloud-functions/api/[[default]].js'],
  bundle: true, platform: 'node', target: 'node20', format: 'esm', write: false,
  plugins: [{ name: 'isolated-env-store', setup(builder) {
    builder.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'fixture', namespace: 'env-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'env-test' }, () => ({
      contents: 'export const getStore = () => globalThis.__idleEnvironmentStore', loader: 'js',
    }))
  } }],
})
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
const start = '2026-10-25T00:00:00Z'
const secret = 'synthetic-node-environment-private-marker'
function setup(t) {
  const keys = ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE', 'ADMIN_PASSWORD', 'ADMIN_USER_ID']
  const old = new Map(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  const objects = new Map()
  globalThis.__idleEnvironmentStore = {
    async get(key) { return structuredClone(objects.get(key) ?? null) },
    async setJSON(key, value) { objects.set(key, structuredClone(value)) },
    async delete(key) { objects.delete(key) },
    async list({ prefix = '' }) { return { blobs: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) } },
  }
  t.after(() => {
    for (const [key, value] of old) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete globalThis.__idleEnvironmentStore
  })
  return objects
}
async function call(env, path = '/account-policy', input) {
  const response = await onRequest({ clientIp: '127.0.0.1', ...(env === undefined ? {} : { env }),
    request: new Request('https://example.test/api' + path, input ? {
      method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' },
    } : {}) })
  return { status: response.status, body: await response.json() }
}

test('real gateway reads Node runtime settings with absent, empty and null context env', async t => {
  setup(t)
  process.env.IDLE_POLICY_START_AT = start
  process.env.IDLE_CLEANUP_EXECUTE = 'true'
  process.env.ADMIN_PASSWORD = secret
  for (const env of [undefined, {}, null]) {
    const result = await call(env)
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { ok: true, enabled: true, executionEnabled: true, idleDays: 180 })
    assert.equal(JSON.stringify(result).includes(secret), false)
  }
})
test('context settings override Node, including explicit empty/false values', async t => {
  setup(t)
  process.env.IDLE_POLICY_START_AT = start
  process.env.IDLE_CLEANUP_EXECUTE = 'true'
  assert.deepEqual((await call({ IDLE_POLICY_START_AT: '', IDLE_CLEANUP_EXECUTE: 'false' })).body,
    { ok: true, enabled: false, executionEnabled: false, idleDays: 180 })
  assert.equal((await call({ IDLE_CLEANUP_EXECUTE: 'false' })).body.executionEnabled, false)
  assert.equal((await call({ IDLE_CLEANUP_EXECUTE: undefined })).body.executionEnabled, true)
})
test('deployment enables automatic policy without console settings; explicit invalid overrides remain off', async t => {
  setup(t)
  process.env.IDLE_CLEANUP_EXECUTE = 'true'
  assert.equal((await call({})).body.executionEnabled, true)
  assert.equal((await call({ IDLE_POLICY_START_AT: 'invalid' })).body.executionEnabled, false)
  process.env.IDLE_POLICY_START_AT = start
  for (const flag of ['false', 'TRUE', '1', '']) {
    process.env.IDLE_CLEANUP_EXECUTE = flag
    assert.equal((await call({})).body.executionEnabled, false)
  }
})
test('SMHE enrollment uses the actual Node password and never returns its contents', async t => {
  setup(t)
  process.env.ADMIN_PASSWORD = secret
  const wrong = await call({}, '/auth/register', { username: 'SMHE', password: '98765432' })
  assert.equal(wrong.status, 401)
  const signed = await call({}, '/auth/register', { username: 'SMHE', password: secret })
  assert.equal(signed.status, 201)
  assert.equal(JSON.stringify(signed).includes(secret), false)
})
test('deployed gateway self-initializes only in ordinary authenticated maintenance without any console configuration', async t => {
  const objects = setup(t)
  const policy = await call({})
  assert.deepEqual(policy.body, { ok: true, enabled: true, executionEnabled: true, idleDays: 180 })
  const activationKey = 'maintenance/idle-policy/v1.json'
  assert.equal(objects.has(activationKey), false)
  const signed = await call({}, '/auth/register', { username: 'automatic-fixture', password: 'synthetic-automatic-password' })
  assert.equal(signed.status, 201)
  assert.equal(objects.has(activationKey), false, 'Registration must not bootstrap project activation')
  const response = await onRequest({ env: {}, clientIp: '127.0.0.1', request: new Request('https://example.test/api/maintenance/idle', {
    method: 'POST', headers: { Authorization: 'Bearer ' + signed.body.token },
  }) })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.status, 'complete')
  assert.equal(result.counts.deleted || 0, 0)
  assert.ok(Number.isFinite(Date.parse(objects.get(activationKey).startedAt)))
})
test('environment resolution does not mutate either provider object', () => {
  const node = Object.freeze({ ADMIN_PASSWORD: secret, IDLE_CLEANUP_EXECUTE: 'true' })
  const edge = Object.freeze({ IDLE_CLEANUP_EXECUTE: 'false', IDLE_POLICY_START_AT: undefined })
  const resolved = runtimeEnvironment(edge, node)
  assert.equal(resolved.IDLE_CLEANUP_EXECUTE, 'false')
  resolved.ADMIN_PASSWORD = 'local-change'
  assert.equal(node.ADMIN_PASSWORD, secret)
})
test('literal Node bindings also work when the provider injects env during function bundling', async () => {
  const result = await build({ entryPoints: ['cloud-functions/_shared/runtime-environment.js'],
    bundle: true, platform: 'node', target: 'node20', format: 'esm', write: false,
    define: { 'process.env.IDLE_POLICY_START_AT': JSON.stringify(start),
      'process.env.IDLE_CLEANUP_EXECUTE': JSON.stringify('true') },
  })
  const { runtimeEnvironment: injected } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
  assert.equal(injected({}).IDLE_POLICY_START_AT, start)
  assert.equal(injected({}).IDLE_CLEANUP_EXECUTE, 'true')
})
test('Node fallback cannot switch existing storage, CORS or sync suspension settings', () => {
  const env = runtimeEnvironment({ BLOB_STORE_NAME: 'existing-context-store', CORS_ORIGIN: 'same-origin' }, {
    BLOB_STORE_NAME: 'unrelated-node-store', CORS_ORIGIN: '*', S2_SYNC_WRITES_DISABLED: 'true',
    IDLE_POLICY_START_AT: start, IDLE_CLEANUP_EXECUTE: 'false',
  })
  assert.equal(env.BLOB_STORE_NAME, 'existing-context-store')
  assert.equal(env.CORS_ORIGIN, 'same-origin')
  assert.equal(env.S2_SYNC_WRITES_DISABLED, undefined)
  assert.equal(env.IDLE_POLICY_START_AT, start)
})
