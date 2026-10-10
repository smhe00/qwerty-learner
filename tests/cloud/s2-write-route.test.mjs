/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

// Integration contract at the actual EdgeOne request handler boundary.
// Mock backend storage/auth so these tests can prove ordering and route wiring.
const calls = []
const source = new URL('../../cloud-functions/api/[[default]].js', import.meta.url).pathname
const result = await build({ entryPoints: [source], bundle: true, write: false,
  format: 'esm', platform: 'node', target: 'node20', plugins: [{
    name: 'mock-edgeone', setup(build) {
      build.onResolve({ filter: /^(?:@edgeone\\/pages-blob|\\.\\.\\/_shared\\/(?:core|auth-rate-limit|storage\\/edgeone-blob)\\.js)$/ }, args =>
        ({ path: args.path, namespace: 'p4b-mock' }))
      build.onLoad({ filter: /.*/, namespace: 'p4b-mock' }, args => {
        const name = args.path
        if (name === '@edgeone/pages-blob') return { contents: 'export const getStore = () => ({})', loader: 'js' }
        if (name.includes('auth-rate-limit')) return { contents: 'export const checkAuthRateLimit = async () => ({ allowed: true })', loader: 'js' }
        if (name.includes('edgeone-blob')) return { contents: 'export const createEdgeOneBlobStorage = () => ({})', loader: 'js' }
        return { contents: `export class AppError extends Error { constructor(statusCode, code, message) { super(message); this.statusCode=statusCode; this.code=code } }
          export const createBackendService = () => ({
            me: async token => ({ user: { userId: token === 'token-a' ? 'id-a' : 'id-b' } }),
            putSyncV4: async () => { globalThis.__p4bCalls.push('v4'); return { revision: 1 } },
            putSyncV4Recovery: async () => { globalThis.__p4bCalls.push('recovery'); return { revision: 2 } },
            putSync: async () => { globalThis.__p4bCalls.push('v1'); return { revision: 3 } },
          })`, loader: 'js' }
      })
    }
  }] })
globalThis.__p4bCalls = calls
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
async function request(path, token, config, body = '{}') {
  calls.length = 0
  const response = await onRequest({ env: config === undefined ? {} : { S2_SYNC_WRITE_ACCOUNT_IDS: config },
    request: new Request('https://qwerty-plus.edgeone.dev/api' + path, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body,
    }) })
  return { status: response.status, data: await response.json(), calls: [...calls] }
}
for (const path of ['/sync/v2', '/sync/v2/recovery']) {
  test(path + ' fails closed on missing, wildcard, or foreign account', async () => {
    for (const config of [undefined, '', '*', 'id-b', 'id-a,*']) {
      const actual = await request(path, 'token-a', config, '{invalid-json')
      assert.equal(actual.status, 403)
      assert.equal(actual.data.error, 's2_write_not_enabled')
      assert.deepEqual(actual.calls, [])
    }
  })
  test(path + ' allows exact account before delegating to original backend', async () => {
    const actual = await request(path, 'token-a', 'id-b,id-a')
    assert.equal(actual.status, 200)
    assert.deepEqual(actual.calls, [path.endsWith('recovery') ? 'recovery' : 'v4'])
  })
}
test('V1 PUT route is unchanged without S2 allowlist', async () => {
  const actual = await request('/sync', 'token-a', undefined)
  assert.equal(actual.status, 200)
  assert.deepEqual(actual.calls, ['v1'])
})
test('missing bearer cannot bypass S2 gate', async () => {
  const result = await request('/sync/v2', '', 'id-a')
  assert.equal(result.status, 401)
  assert.deepEqual(result.calls, [])
})
