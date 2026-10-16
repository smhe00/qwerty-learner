/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { resetAuthRateLimitMemoryForTest } from '../../cloud-functions/_shared/auth-rate-limit.js'
import {
  blocksCircleEtestAccountDeletion, createCircleEtestGateway,
} from '../../cloud-functions/_shared/circle/etest-gateway.js'

const owner = 'a'.repeat(32)
const student = 'b'.repeat(32)
const visitor = 'c'.repeat(32)
const env = {
  CIRCLE_ETEST_ENABLED: 'true',
  CIRCLE_ETEST_BLOB_STORE: 'qwerty-circle-sandbox',
  CIRCLE_ETEST_INVITE_KEY: 'an-isolated-test-secret-not-used-in-production-123456',
  CIRCLE_ETEST_USER_IDS: owner + ',' + student,
}

function fixture() {
  resetAuthRateLimitMemoryForTest()
  const blobs = new Map()
  const counters = new Map()
  const stores = []
  const backend = {
    me: async (token) => {
      if (token === 'expired') throw new AppError(401, 'session_revoked', 'Revoked')
      if (![owner, student, visitor].includes(token)) throw new AppError(401, 'invalid_token', 'Invalid')
      return { user: { userId: token }, session: { version: 1, expiresAt: 9999999999 } }
    },
  }
  const getStore = ({ name, consistency }) => {
    stores.push({ name, consistency })
    if (name !== 'qwerty-circle-sandbox') throw Error('test must never access V4 store')
    return {
      async setJSON(key, value, options) {
        assert.equal(options, undefined)
        blobs.set(key, structuredClone(value))
      },
      async list({ prefix, consistency: readConsistency }) {
        assert.equal(readConsistency, 'strong')
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
  const gateway = createCircleEtestGateway({ backend, getStore, rateStorage })
  const context = (request, overrides = {}) =>
    ({ request, env: { ...env, ...overrides.env }, clientIp: overrides.clientIp ?? '192.0.2.123' })
  const call = async (url, { method = 'GET', token = owner, body, ...overrides } = {}) => {
    const request = new Request(url, { method,
      headers: token ? { Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const response = await gateway.handle(context(request, overrides))
    return { status: response.status, body: await response.json() }
  }
  return { gateway, call, context, blobs, stores }
}

test('retired pilot gateway remains closed off etest without opening Blob Store', async () => {
  const f = fixture()
  assert.equal((await f.call('https://qwerty-plus.edgeone.dev/api/circle/v2')).status, 404)
  assert.equal((await f.call('https://etest.edgeone.dev/api/circle/v2', {
    env: { CIRCLE_ETEST_ENABLED: 'false' },
  })).status, 404)
  assert.equal(f.stores.length, 0)
  // Historical pilot handler remains closed outside etest. The active
  // public gateway is validated separately in circle-open-gateway.test.mjs.
})
test('pilot is closed without explicit isolated namespace, secret or test account allowlist', async () => {
  for (const change of [
    { CIRCLE_ETEST_BLOB_STORE: 'qwerty-data' },
    { CIRCLE_ETEST_INVITE_KEY: 'short' },
    { CIRCLE_ETEST_USER_IDS: '' },
    { CIRCLE_ETEST_USER_IDS: '../accounts' },
  ]) {
    const f = fixture()
    const result = await f.call('https://etest.edgeone.dev/api/circle/v2', { env: change })
    assert.equal(result.status, 503)
    assert.equal(result.body.error, 'circle_etest_not_configured')
    assert.equal(f.stores.length, 0)
  }
})
test('pilot rejects missing trusted edge IP and session/allowlist abuse', async () => {
  const f = fixture()
  const url = 'https://etest.edgeone.dev/api/circle/v2'
  assert.equal((await f.call(url, { clientIp: ' '.repeat(3) })).status, 503)
  assert.equal((await f.call(url, { method: 'POST', token: 'expired',
    body: { name: 'wrong', operationId: 'create_test_001' } })).status, 401)
  const result = await f.call(url, { method: 'POST', token: visitor,
    body: { name: 'wrong', operationId: 'create_test_001' } })
  assert.equal(result.status, 403)
  assert.equal(result.body.error, 'circle_etest_account_denied')
  assert.equal(f.blobs.size, 0)
})
test('etest end-to-end server transport writes only unique Circle Blob event keys', async () => {
  const f = fixture()
  const url = 'https://etest.edgeone.dev/api/circle/v2'
  const create = await f.call(url, { method: 'POST',
    body: { name: 'Classroom', operationId: 'create_test_001' } })
  assert.equal(create.status, 202)
  const circleId = create.body.result.circleId
  const join = await f.call(url + '/join', { method: 'POST', token: student,
    body: { inviteCode: create.body.result.inviteCode } })
  assert.equal(join.status, 202)
  assert.equal(join.body.result.final, false)
  const view = await f.call(url + '/' + circleId)
  assert.equal(view.status, 200)
  assert.equal(view.body.result.members.length, 2)
  const close = await f.call(url + '/' + circleId + '/close', {
    method: 'POST', body: {} })
  assert.equal(close.status, 202)
  assert.equal(close.body.result.consistency, 'eventual')
  assert.equal(close.body.result.final, false)
  assert.equal((await f.call(url + '/' + circleId)).status, 410)
  assert.equal(f.blobs.size, 3)
  for (const key of f.blobs.keys()) {
    assert.match(key, /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/)
  }
  assert.ok(f.stores.every((s) => s.name === 'qwerty-circle-sandbox'))
})
test('per-IP limiter caps bursts without claiming strong global atomic counters', async () => {
  const f = fixture()
  const url = 'https://etest.edgeone.dev/api/circle/v2/' + 'd'.repeat(24)
  const outcomes = []
  for (let i = 0; i < 62; i++) outcomes.push((await f.call(url)).status)
  assert.equal(outcomes.at(-1), 429)
  assert.ok(outcomes.includes(503)) // Missing Circle events are uncertain, never authorization success.
  assert.equal(f.blobs.size, 0)
})
test('etest test-account deletion refuses orphaned social events; ordinary accounts unchanged', () => {
  assert.equal(blocksCircleEtestAccountDeletion({
    hostname: 'etest.edgeone.dev', env, userId: owner,
  }), true)
  assert.equal(blocksCircleEtestAccountDeletion({
    hostname: 'etest.edgeone.dev', env, userId: visitor,
  }), false)
  assert.equal(blocksCircleEtestAccountDeletion({
    hostname: 'qwerty-plus.edgeone.dev', env, userId: owner,
  }), false)
  assert.equal(blocksCircleEtestAccountDeletion({
    hostname: 'etest.edgeone.dev', env: { ...env, CIRCLE_ETEST_ENABLED: 'false' }, userId: owner,
  }), true, 'Turning off Circle must not remove the deletion safety fence')
  assert.equal(blocksCircleEtestAccountDeletion({
    hostname: 'etest.edgeone.dev', env: { ...env, CIRCLE_ETEST_USER_IDS: '' }, userId: owner,
  }), false)
})
