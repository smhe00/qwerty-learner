/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

test('real gateway enforces live sessions and server admin role for private feedback', async () => {
  const blobs = new Map()
  globalThis.__feedbackRouteStore = {
    async get(key) { return structuredClone(blobs.get(key) ?? null) },
    async setJSON(key, value) { blobs.set(key, structuredClone(value)) },
    async delete(key) { blobs.delete(key) },
    async list({ prefix, limit = 1000, cursor = '' }) {
      const keys = [...blobs.keys()].filter(key => key.startsWith(prefix)).sort(), start = Number(cursor || 0)
      return { blobs: keys.slice(start, start + limit).map(key => ({ key })), cursor: start + limit < keys.length ? String(start + limit) : undefined }
    },
  }
  const built = await build({ entryPoints: ['cloud-functions/api/[[default]].js'], bundle: true,
    platform: 'node', target: 'node20', format: 'esm', write: false, plugins: [{ name: 'feedback-store', setup(b) {
      b.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'store', namespace: 'feedback' }))
      b.onLoad({ filter: /.*/, namespace: 'feedback' }, () => ({ contents: 'export const getStore = () => globalThis.__feedbackRouteStore', loader: 'js' }))
    } }] })
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  let ip = 0
  const env = { branch: 'master', ADMIN_PASSWORD: 'synthetic-feedback-admin', IDLE_CLEANUP_EXECUTE: 'false' }
  async function call(path, { token, body, method = body ? 'POST' : 'GET', raw } = {}) {
    const response = await onRequest({ env, clientIp: '192.0.2.' + (++ip), request: new Request('https://example.test/api' + path, {
      method, headers: { ...(token ? { authorization: 'Bearer ' + token } : { 'x-feedback-key': 'a'.repeat(64) }), 'Content-Type': 'application/json' },
      ...(body || raw ? { body: raw || JSON.stringify(body) } : {}),
    }) })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return { status: response.status, data: await response.json() }
  }
  try {
    const normal = await call('/auth/register', { body: { username: 'feedbacktest', password: 'synthetic-password' } })
    assert.equal(normal.status, 201)
    const admin = await call('/auth/login', { body: { username: 'admin', password: env.ADMIN_PASSWORD } })
    assert.equal(admin.status, 200)
    assert.equal(admin.data.user.username, 'admin')
    assert.equal((await call('/admin/access', { token: admin.data.token })).data.administrator, true)
    const item = await call('/feedback', { token: normal.data.token, body: { operationId: '1'.repeat(32), title: '私密反馈', text: '问题描述' } })
    assert.equal(item.status, 200)
    const path = '/feedback/' + item.data.owner + '/' + item.data.id
    assert.equal((await call(path)).status, 404)
    assert.equal((await call('/feedback?scope=all', { token: normal.data.token })).status, 403)
    assert.equal((await call('/feedback?scope=all', { token: admin.data.token })).data.items.length, 1)
    assert.equal((await call(path + '/messages', { token: admin.data.token, body: { operationId: '2'.repeat(32), text: '回复', status: 'resolved' } })).status, 200)
    assert.equal((await call(path, { token: normal.data.token })).data.status, 'resolved')
    assert.equal((await call('/feedback', { method: 'POST', raw: '{invalid-json' })).status, 400)
    assert.equal((await call('/feedback', { body: { text: 'x'.repeat(20000) } })).status, 413)
    await call('/auth/login', { body: { username: 'feedbacktest', password: 'synthetic-password' } })
    assert.equal((await call(path, { token: normal.data.token })).status, 401)
  } finally { delete globalThis.__feedbackRouteStore }
})
