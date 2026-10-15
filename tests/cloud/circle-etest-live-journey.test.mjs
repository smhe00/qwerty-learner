/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../cloud-functions/_shared/core.js'
import { createCircleEventualAssembly } from '../../cloud-functions/_shared/circle/assembly.js'
import { runCircleEtestJourney } from '../../scripts/circle-etest-live-journey.mjs'

const ownerId = 'a'.repeat(32)
const memberId = 'b'.repeat(32)
const ownerToken = 'owner-token-' + 'o'.repeat(64)
const memberToken = 'member-token-' + 'm'.repeat(64)
const sha = '0123456789abcdef0123456789abcdef01234567'
const env = Object.freeze({
  EXPECTED_ETEST_SHA: sha,
  CIRCLE_LIVE_ACK: 'RUN_ISOLATED_ETEST_CIRCLE_ONLY',
  CIRCLE_DISPOSABLE_ACCOUNTS_ACK: 'I_ACCEPT_TEST_ACCOUNT_RETENTION_GUARD',
  CIRCLE_OWNER_USER_ID: ownerId, CIRCLE_MEMBER_USER_ID: memberId,
  CIRCLE_OWNER_TOKEN: ownerToken, CIRCLE_MEMBER_TOKEN: memberToken,
})

function fixture({ enabled = true, wrongSession = false, delayedCreation = false } = {}) {
  const events = new Map()
  let hideCreationOnce = delayedCreation
  const calls = []
  const logs = []
  const backend = {
    async me(token) {
      if (token === ownerToken) return { user: { userId: wrongSession ? memberId : ownerId } }
      if (token === memberToken) return { user: { userId: memberId } }
      throw new AppError(401, 'invalid_token', 'Invalid test session')
    },
  }
  const blobStore = {
    async setJSON(key, event, options) {
      assert.equal(options, undefined, 'No onlyIfNew/CAS in event log')
      assert.match(key, /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/)
      events.set(key, structuredClone(event))
    },
    async get(key) { return structuredClone(events.get(key) ?? null) },
    async list({ prefix }) {
      const keys = [...events.entries()].filter(([key, event]) =>
        key.startsWith(prefix) && !(hideCreationOnce && event.type === 'CIRCLE_CREATED'))
      hideCreationOnce = false
      return { blobs: keys.map(([key]) => ({ key })) }
    },
  }
  const assembly = createCircleEventualAssembly({
    backend, blobStore, inviteKey: 'isolated-test-invite-secret-minimum-32-chars',
    limit: async ({ token }) => [ownerToken, memberToken].includes(token),
  })
  const fetchImpl = async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method,
      hasAuth: Boolean(init.headers.Authorization) })
    assert.equal(new URL(url).origin, 'https://etest.edgeone.dev')
    const path = new URL(url).pathname
    if (path === '/source-commit.txt') {
      return new Response(sha.slice(0, 7), { status: 200 })
    }
    if (path === '/api/health') {
      return Response.json({ ok: true, service: 'qwerty-sync-gateway' })
    }
    if (path === '/api/auth/me') {
      try {
        return Response.json({ ok: true, ...await backend.me(init.headers.Authorization?.slice(7)) })
      } catch { return Response.json({ ok: false, error: 'invalid_token' }, { status: 401 }) }
    }
    if (path.startsWith('/api/circle/v2')) {
      if (!enabled) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
      return assembly.transport.handle(new Request(url, init))
    }
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  const run = (mode, changes = {}) => runCircleEtestJourney({
    mode, env: { ...env, ...changes }, fetchImpl, write: (v) => logs.push(v),
    sleep: async () => {}, nonce: '0123456789abcdef',
  })
  return { events, calls, logs, run }
}

test('read-only preflight reports disabled pilot, never sends auth or creates Blob events', async () => {
  const f = fixture({ enabled: false })
  const status = await f.run('preflight', { CIRCLE_OWNER_TOKEN: undefined })
  assert.equal(status.gateStatus, 404)
  assert.equal(status.interpretation, 'manual_feature_activation_required')
  assert.equal(status.writes, 0)
  assert.equal(f.events.size, 0)
  assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'GET', 'POST'])
  assert.ok(f.calls.every((c) => !c.hasAuth))
})

test('explicit write mode rejects missing approval, mismatched accounts, wrong SHA or session', async () => {
  const f = fixture()
  for (const changes of [
    { CIRCLE_LIVE_ACK: '' },
    { CIRCLE_DISPOSABLE_ACCOUNTS_ACK: '' },
    { EXPECTED_ETEST_SHA: 'a'.repeat(40) },
    { CIRCLE_OWNER_USER_ID: memberId },
    { CIRCLE_MEMBER_TOKEN: ownerToken },
  ]) {
    await assert.rejects(f.run('run', changes))
  }
  assert.equal(f.events.size, 0)
  const bad = fixture({ wrongSession: true })
  await assert.rejects(bad.run('run'), /does not match authenticated session/)
  assert.equal(bad.events.size, 0)
  const disabled = fixture({ enabled: false })
  await assert.rejects(disabled.run('run'), /Circle is not enabled/)
  assert.equal(disabled.events.size, 0)
})

test('full opt-in etest HTTP journey uses immutable sessions and leaves explicit cleanup debt', async () => {
  const f = fixture()
  const result = await f.run('run')
  assert.equal(result.pass, true)
  assert.equal(result.writes, 6)
  assert.equal(result.state, 'closed_with_events_retained')
  assert.match(result.circleId, /^[a-f0-9]{24}$/)
  assert.equal(f.events.size, 6)
  assert.deepEqual([...f.events.values()].map((v) => v.type).sort(), [
    'CIRCLE_CLOSED', 'CIRCLE_CREATED', 'CLAP_ADDED', 'JOIN_REQUESTED',
    'MEMBER_REMOVED', 'PROGRESS_PUBLISHED',
  ].sort())
  assert.ok(f.calls.some((c) => c.path === '/api/auth/me' && c.hasAuth))
  assert.ok(f.logs.some((v) => v.includes('retained')))
  assert.ok(f.logs.every((v) => !v.includes(ownerToken) && !v.includes(memberToken)))
})

test('live workflow retries a newly created circle invisible on its first Blob listing', async () => {
  const f = fixture({ delayedCreation: true })
  const result = await f.run('run')
  assert.equal(result.pass, true)
  assert.equal(f.events.size, 6)
  assert.ok(f.calls.filter((c) => c.method === 'GET' &&
    /^\/api\/circle\/v2\/[a-f0-9]{24}$/.test(c.path)).length >= 5)
})

test('live journey refuses an unknown mode without calling network or touching social data', async () => {
  const f = fixture()
  await assert.rejects(f.run('delete-all'), /Choose --preflight or --run/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.events.size, 0)
})
