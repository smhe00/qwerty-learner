/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { resetAuthRateLimitMemoryForTest } from '../../cloud-functions/_shared/auth-rate-limit.js'
import { circleAccountHasActivity, createCircleOpenGateway } from '../../cloud-functions/_shared/circle/open-gateway.js'

const owner = 'a'.repeat(32)
const student = 'b'.repeat(32)
const stranger = 'c'.repeat(32)
const operationId = 'af48796a-1736-4c3e-8d5f-e82946394401'
function fixture() {
  resetAuthRateLimitMemoryForTest()
  const blobs = new Map()
  const writes = []
  const counters = new Map()
  const stores = []
  const backend = {
    async me(token) {
      if (token === 'expired') throw new AppError(401, 'session_revoked', 'Revoked')
      if (![owner, student, stranger].includes(token)) throw new AppError(401, 'invalid_token', 'Invalid')
      return { user: { userId: token } }
    },
  }
  const getStore = ({ name, consistency }) => {
    stores.push({ name, consistency })
    assert.equal(name, 'qwerty-data')
    assert.equal(consistency, 'strong')
    return {
      async setJSON(key, value, options) {
        assert.equal(options, undefined)
        assert.match(key, /^social\/v2\//)
        writes.push(key)
        blobs.set(key, structuredClone(value))
      },
      async list({ prefix, consistency: readConsistency }) {
        assert.equal(readConsistency, 'strong')
        assert.match(prefix, /^social\/v2\/circles\//)
        return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }
      },
      async get(key, { type, consistency: readConsistency }) {
        assert.equal(type, 'json')
        assert.equal(readConsistency, 'strong')
        return structuredClone(blobs.get(key) ?? null)
      },
    }
  }
  const rateStorage = {
    async getAuthRateLimitCounter(key, window) { return counters.get(key + '/' + window) ?? null },
    async setAuthRateLimitCounter(key, window, value) { counters.set(key + '/' + window, value) },
    async pruneAuthRateLimitCounters() {},
  }
  const gateway = createCircleOpenGateway({ backend, getStore, rateStorage })
  const context = (request, clientIp = '192.0.2.1') =>
    ({ request, env: {}, clientIp })
  const call = async (path = '', { method = 'GET', token = owner, body, clientIp } = {}) => {
    const request = new Request('https://q.smhe.cn/api/circle/v2' + path, {
      method,
      headers: token ? { Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const response = await gateway.handle(context(request, clientIp))
    return { status: response.status, data: await response.json() }
  }
  return { call, blobs, writes, getStore, stores }
}

test('public Circle API requires account session, not rollout flags or account allowlist', async () => {
  const f = fixture()
  assert.equal((await f.call('', { method: 'POST', token: null,
    body: { name: 'Classroom', operationId } })).status, 401)
  assert.equal((await f.call('', { method: 'POST', token: 'expired',
    body: { name: 'Classroom', operationId } })).status, 401)
  assert.equal((await f.call('', { method: 'POST', token: owner,
    body: { name: 'Classroom', operationId: 'create_test_001' } })).status, 400)
  assert.equal(f.blobs.size, 0)
  assert.ok(f.stores.every((x) => x.name === 'qwerty-data'))
})

test('public Circle can create, retry, join, publish, remove and close without environment setup', async () => {
  const f = fixture()
  const before = await circleAccountHasActivity({ getStore: f.getStore, userId: owner })
  assert.equal(before, false)
  const c = await f.call('', { method: 'POST',
    body: { name: 'Classroom', operationId } })
  assert.equal(c.status, 202)
  assert.equal(c.data.ok, true)
  const retry = await f.call('', { method: 'POST',
    body: { name: 'Classroom', operationId } })
  assert.equal(retry.status, 202)
  assert.equal(retry.data.result.inviteCode, c.data.result.inviteCode)
  const id = c.data.result.circleId
  assert.equal(await circleAccountHasActivity({ getStore: f.getStore, userId: owner }), true)
  assert.equal(await circleAccountHasActivity({ getStore: f.getStore, userId: student }), false)
  assert.equal(f.writes[0], 'social/v2/accounts/' + owner + '/used.json')
  assert.match(f.writes[1], /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/)

  const join = await f.call('/join', { method: 'POST', token: student,
    body: { inviteCode: c.data.result.inviteCode } })
  assert.equal(join.status, 202)
  assert.equal(await circleAccountHasActivity({ getStore: f.getStore, userId: student }), true)
  const view = await f.call('/' + id)
  assert.equal(view.status, 200)
  assert.equal(view.data.result.members.length, 2)
  assert.equal((await f.call('/' + id, { token: stranger })).status, 403)
  const progress = await f.call('/' + id + '/progress/2026-10-17',
    { method: 'POST', token: student,
      body: { completed: true, newWords: 10, eventId: 'progress_0001' } })
  assert.equal(progress.status, 202)
  const removal = await f.call('/' + id + '/remove',
    { method: 'POST', body: { memberUserId: student } })
  assert.equal(removal.status, 202)
  assert.equal((await f.call('/' + id, { token: student })).status, 403)
  const closed = await f.call('/' + id + '/close', { method: 'POST', body: {} })
  assert.equal(closed.status, 202)
  assert.equal((await f.call('/' + id)).status, 410)
  assert.ok([...f.blobs.keys()].every((k) => k.startsWith('social/v2/')))
  assert.ok([...f.blobs.keys()].every((k) => !k.startsWith('accounts/') && !k.startsWith('users/')))
})

test('missing trusted EdgeOne client IP is fail-closed', async () => {
  const f = fixture()
  const result = await f.call('', { method: 'POST', clientIp: ' ',
    body: { name: 'Classroom', operationId } })
  assert.equal(result.status, 503)
  assert.equal(result.data.error, 'circle_client_ip_unavailable')
  assert.equal(f.blobs.size, 0)
})
