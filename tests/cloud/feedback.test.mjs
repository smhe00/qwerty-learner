/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFeedbackService } from '../../cloud-functions/_shared/feedback.js'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { resetAuthRateLimitMemoryForTest } from '../../cloud-functions/_shared/auth-rate-limit.js'

const account = 'a'.repeat(32), other = 'b'.repeat(32), admin = 'c'.repeat(32)
const secret = 'd'.repeat(64)
function fixture() {
  resetAuthRateLimitMemoryForTest()
  const blobs = new Map(), writes = []
  let fault = '', outside = false
  const store = {
    async get(key) { return structuredClone(blobs.get(key) ?? null) },
    async setJSON(key, value) {
      writes.push(key)
      if (fault === 'before') throw Error('offline')
      blobs.set(key, structuredClone(value))
      if (fault === 'after') throw Error('lost ACK')
    },
    async list({ prefix, cursor, limit, paginate, consistency }) {
      assert.equal(paginate, false); assert.equal(consistency, 'strong')
      const keys = [...blobs.keys()].filter(k => k.startsWith(prefix)).sort()
      const start = Number(cursor || 0), page = keys.slice(start, start + limit)
      if (outside) page.push('users/another-account/secret.json')
      return { blobs: page.map(key => ({ key })), cursor: start + limit < keys.length ? String(start + limit) : undefined }
    },
  }
  const service = createFeedbackService({ store, rateStorage: {},
    backend: { async me(token) {
      if (![account, other, admin].includes(token)) throw new AppError(401, 'invalid_token', 'Invalid')
      return { user: { userId: token, username: token === admin ? 'smhe' : 'student' } }
    } }, administrator: { isAdministrator: identity => identity.userId === admin },
  })
  let sequence = 0
  const call = (path = '', { token, key = secret, body, ip = '192.0.2.1', method = body ? 'POST' : 'GET' } = {}) => service.handle({
    request: new Request('https://test.invalid/api/feedback' + path, { method, headers: token ? { authorization: 'Bearer ' + token } : { 'x-feedback-key': key } }),
    clientIp: ip, readBody: async size => { assert.equal(size, 16384); return body },
  })
  const create = options => call('', { ...options, body: { operationId: (++sequence).toString(16).padStart(32, '0'), title: '建议', text: '更清楚的提示', ...options?.body } })
  return { call, create, blobs, writes, setFault: value => { fault = value }, setOutside: () => { outside = true } }
}
const route = item => '/' + item.owner + '/' + item.id
const rejects = (promise, status) => assert.rejects(promise, error => error.statusCode === status)

test('anonymous threads remain private; same secret recovers on a different device', async () => {
  const f = fixture(), item = await f.create()
  assert.equal((await f.call()).items.length, 1)
  assert.equal((await f.call(route(item), { ip: '192.0.2.9' })).text, '更清楚的提示')
  await rejects(f.call(route(item), { key: 'e'.repeat(64) }), 404)
  assert.deepEqual((await f.call('', { key: 'e'.repeat(64) })).items, [])
  await rejects(f.call('', { key: '' }), 401)
  await rejects(f.call('?scope=all'), 403)
  assert.ok([...f.blobs.values()].every(x => !JSON.stringify(x).includes(secret)))
  assert.ok(f.writes.every(key => key.startsWith('feedback/v1/')))
})
test('account ownership is verified server-side; expired auth cannot fall back to guest', async () => {
  const f = fixture(), item = await f.create({ token: account, body: { owner: other, administrator: true } })
  assert.equal(item.owner, 'a-' + account)
  await rejects(f.call(route(item), { token: other }), 404)
  await rejects(f.call(route(item)), 404)
  await rejects(f.call('', { token: 'expired' }), 401)
  await rejects(f.call('?scope=all', { token: account }), 403)
  assert.ok(f.writes.some(key => key.startsWith(`users/${account}/feedback/`)))
})
test('administrator replies/status and submitter follow-up form one private conversation', async () => {
  const f = fixture(), item = await f.create({ token: account })
  assert.equal((await f.call('?scope=all', { token: admin })).items.length, 1)
  await f.call(route(item) + '/messages', { token: admin, body: { operationId: '1'.repeat(32), text: '已经修复', status: 'resolved' } })
  let detail = await f.call(route(item), { token: account })
  assert.equal(detail.status, 'resolved'); assert.equal(detail.messages[0].role, 'admin')
  await rejects(f.call(route(item) + '/messages', { token: account, body: { operationId: '2'.repeat(32), text: '冒充管理员', status: 'resolved' } }), 403)
  await new Promise(resolve => setTimeout(resolve, 2))
  await f.call(route(item) + '/messages', { token: account, body: { operationId: '2'.repeat(32), text: '仍有问题' } })
  detail = await f.call(route(item), { token: account })
  assert.equal(detail.status, 'waiting'); assert.equal(detail.messages.length, 2)
})
test('lost ACK and repeated create/reply use identical immutable keys', async () => {
  const f = fixture(), body = { operationId: '5'.repeat(32), title: 'test', text: 'hello' }
  f.setFault('after')
  const item = await f.call('', { body })
  await f.call('', { body })
  const reply = { operationId: '6'.repeat(32), text: 'reply' }
  await f.call(route(item) + '/messages', { body: reply })
  await f.call(route(item) + '/messages', { body: reply })
  assert.equal(f.writes.length, 3)
  assert.equal((await f.call(route(item))).messages.length, 1)
})
test('offline writes stay unconfirmed and same request resumes after connectivity returns', async () => {
  const f = fixture(), body = { operationId: '5'.repeat(32), title: 'test', text: 'hello' }
  f.setFault('before')
  await rejects(f.call('', { body }), 503)
  f.setFault('')
  await f.call('', { body }); await f.call('', { body })
  assert.equal((await f.call()).items.length, 1)
})
test('concurrent user and admin replies cannot overwrite each other', async () => {
  const f = fixture(), item = await f.create()
  await Promise.all([
    f.call(route(item) + '/messages', { body: { operationId: '7'.repeat(32), text: '补充信息' } }),
    f.call(route(item) + '/messages', { token: admin, body: { operationId: '8'.repeat(32), text: '收到' } }),
  ])
  assert.equal((await f.call(route(item))).messages.length, 2)
})
test('content limits, malformed selectors, missing trusted IP and write budget fail closed', async () => {
  const f = fixture()
  await rejects(f.create({ body: { text: 'x'.repeat(2001) } }), 400)
  await rejects(f.create({ body: { title: ' ' } }), 400)
  await rejects(f.create({ ip: '' }), 503)
  await rejects(f.call('/invalid/id'), 404)
  await rejects(f.call('?cursor=' + 'x'.repeat(2049)), 400)
  for (let i = 0; i < 8; i++) await f.create()
  await rejects(f.create(), 429)
})
test('pagination preserves owner scope and rejects storage results outside it', async () => {
  const f = fixture()
  for (let i = 0; i < 23; i++) await f.create({ ip: '192.0.2.' + i })
  const first = await f.call(), second = await f.call('?cursor=' + first.cursor)
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 3)
  assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 23)
  f.setOutside()
  await rejects(f.call(), 503)
})
test('account erasure makes opaque index entries invisible; guest feedback unaffected', async () => {
  const f = fixture(), item = await f.create({ token: account })
  await f.create()
  for (const key of f.blobs.keys()) if (key.startsWith(`users/${account}/`)) f.blobs.delete(key)
  assert.equal((await f.call('?scope=all', { token: admin })).items.length, 1)
  await rejects(f.call(route(item), { token: admin }), 404)
  assert.equal((await f.call()).items.length, 1)
})
