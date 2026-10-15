/* eslint-env node */
// Strict opt-in live API journey. Preflight makes NO authenticated or state-changing
// request. --run creates persistent Circle events ONLY for dedicated etest accounts.
// Never run against production, never put bearer tokens in command-line args/logs.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const BASE = 'https://etest.edgeone.dev'
const ROOT = BASE + '/api/circle/v2'
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/
const MAX_POLL = 20

async function request(fetcher, path, { method = 'GET', token, data } = {}) {
  const headers = { 'Cache-Control': 'no-store' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (data !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetcher(BASE + path, {
    method, headers, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  // Do not echo server response bodies or credentials into a CI log.
  let value
  if (res.headers.get('content-type')?.includes('application/json')) {
    try { value = await res.json() } catch { throw new Error('Invalid JSON from etest') }
  } else if (res.status === 200) {
    value = await res.text()
  }
  return { status: res.status, value }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const expectStatus = (actual, expected, label) => {
  assert.equal(actual.status, expected, label + ' HTTP status ' + actual.status)
  if (expected < 300) assert.equal(actual.value?.ok, true, label + ' JSON ok')
  return actual.value?.result
}

export async function runCircleEtestJourney({
  mode, env = process.env, fetchImpl = fetch,
  write = (line) => console.log(line),
  sleep = pause, nonce = crypto.randomBytes(8).toString('hex'),
} = {}) {
  assert.ok(mode === 'preflight' || mode === 'run', 'Choose --preflight or --run')
  assert.match(nonce, /^[a-f0-9]{16}$/, 'Unique non-secret run identifier required')
  const expectedSha = env.EXPECTED_ETEST_SHA
  if (mode === 'run') {
    // Explicit double acknowledgment because test accounts will retain Circle
    // objects and their account deletion is blocked pending an audited scrub.
    assert.equal(env.CIRCLE_LIVE_ACK, 'RUN_ISOLATED_ETEST_CIRCLE_ONLY')
    assert.equal(env.CIRCLE_DISPOSABLE_ACCOUNTS_ACK, 'I_ACCEPT_TEST_ACCOUNT_RETENTION_GUARD')
    assert.match(expectedSha || '', /^[a-f0-9]{40}$/, 'Expected deployed etest SHA required')
    assert.match(env.CIRCLE_OWNER_USER_ID || '', SAFE_ID, 'Owner immutable V4 user ID required')
    assert.match(env.CIRCLE_MEMBER_USER_ID || '', SAFE_ID, 'Member immutable V4 user ID required')
    assert.notEqual(env.CIRCLE_OWNER_USER_ID, env.CIRCLE_MEMBER_USER_ID,
      'Two distinct immutable V4 test account IDs required')
    assert.ok(env.CIRCLE_OWNER_TOKEN?.length > 40 && env.CIRCLE_MEMBER_TOKEN?.length > 40 &&
      env.CIRCLE_OWNER_TOKEN !== env.CIRCLE_MEMBER_TOKEN,
    'Distinct real etest bearer session tokens required')
  }
  const health = await request(fetchImpl, '/api/health')
  assert.equal(health.status, 200, 'etest health unavailable')
  assert.equal(health.value?.service, 'qwerty-sync-gateway',
    'Unexpected host or application')
  const source = await request(fetchImpl, '/source-commit.txt')
  assert.equal(source.status, 200, 'etest deployment marker unavailable')
  const marker = String(source.value || '').trim()
  assert.match(marker, /^[a-f0-9]{7,40}$/, 'Invalid etest source marker')
  if (expectedSha) {
    assert.match(expectedSha, /^[a-f0-9]{40}$/, 'Expected etest SHA must be 40 hex chars')
    assert.ok(expectedSha.startsWith(marker), 'Deployed etest build is not the expected commit')
  }
  // Deliberately send POST with NO bearer token. The enabled transport must
  // reject with 401 before body validation, without creating any event.
  const gate = await request(fetchImpl, '/api/circle/v2', { method: 'POST' })
  const preflight = {
    mode: 'preflight', marker, gateStatus: gate.status,
    interpretation: gate.status === 401 ? 'enabled_auth_required'
      : gate.status === 404 ? 'manual_feature_activation_required'
        : gate.status === 503 ? 'manual_isolated_store_or_config_required'
          : 'unexpected_gateway_status',
    writes: 0,
  }
  write(JSON.stringify(preflight))
  if (mode === 'preflight') return preflight
  assert.equal(gate.status, 401, 'Circle is not enabled/configured for etest; no writes performed')

  // Independently verify session->immutable account mapping. No username,
  // client-provided ID, or other user data is ever accepted as authority.
  for (const [label, token, id] of [
    ['owner', env.CIRCLE_OWNER_TOKEN, env.CIRCLE_OWNER_USER_ID],
    ['member', env.CIRCLE_MEMBER_TOKEN, env.CIRCLE_MEMBER_USER_ID],
  ]) {
    const me = await request(fetchImpl, '/api/auth/me', { token })
    assert.equal(me.status, 200, label + ' account not authenticated')
    assert.equal(me.value?.user?.userId, id, label + ' ID does not match authenticated session')
  }

  const owner = env.CIRCLE_OWNER_TOKEN
  const member = env.CIRCLE_MEMBER_TOKEN
  const ownerId = env.CIRCLE_OWNER_USER_ID
  const memberId = env.CIRCLE_MEMBER_USER_ID
  const day = new Date().toISOString().slice(0, 10)
  let circleId
  let writes = 0
  const post = async (path, token, data, label) => {
    const r = await request(fetchImpl, path, { method: 'POST', token, data })
    const result = expectStatus(r, 202, label)
    assert.equal(result?.status, 'pending', label + ' must be eventually consistent')
    writes++
    return result
  }
  const waitFor = async (label, predicate) => {
    for (let attempt = 0; attempt < MAX_POLL; attempt++) {
      const value = await predicate()
      if (value === true) return
      if (attempt < MAX_POLL - 1) await sleep(4000)
    }
    throw new Error(label + ' did not converge in bounded time')
  }
  try {
    const created = await post('/api/circle/v2', owner, {
      name: 'QA Circle ' + nonce.slice(0, 8), operationId: 'circle_create_' + nonce,
    }, 'create circle')
    circleId = created.circleId
    assert.match(circleId || '', /^[a-f0-9]{24}$/, 'Invalid server circle ID')
    assert.match(created.inviteCode || '', /^QC2-[a-f0-9]{24}-[a-f0-9]{32}$/)
    const path = '/api/circle/v2/' + circleId
    // An acknowledged append is not immediately visible on every Blob node.
    await waitFor('new circle visibility before invitation', async () => {
      const r = await request(fetchImpl, path, { token: owner })
      return r.status === 200 && r.value?.result?.meta?.ownerUserId === ownerId
    })
    const joined = await post('/api/circle/v2/join', member,
      { inviteCode: created.inviteCode }, 'join circle')
    assert.equal(joined.final, false, 'Join must not claim immediate finality')
    await waitFor('joining member', async () => {
      const r = await request(fetchImpl, path, { token: owner })
      return r.status === 200 && r.value?.result?.members?.some((m) => m.userId === memberId)
    })
    await post(path + '/progress/' + day, member,
      { eventId: 'progress_' + nonce, completed: true, newWords: 12 }, 'publish progress')
    await waitFor('visible progress', async () => {
      const r = await request(fetchImpl, path, { token: owner })
      return r.status === 200 && r.value?.result?.progress?.some((p) =>
        p.authorUserId === memberId && p.day === day && p.newWords === 12)
    })
    await post(path + '/claps', owner, { memberUserId: memberId, day }, 'clap')
    await waitFor('visible clap', async () => {
      const r = await request(fetchImpl, path, { token: owner })
      return r.status === 200 && r.value?.result?.claps?.some((c) =>
        c.authorUserId === memberId && c.day === day)
    })
    await post(path + '/remove', owner, { memberUserId: memberId }, 'remove member')
    await waitFor('member removal', async () => {
      const r = await request(fetchImpl, path, { token: member })
      return r.status === 403 && r.value?.error === 'not_circle_member'
    })
    const closed = await post(path + '/close', owner, {}, 'close circle')
    assert.equal(closed.final, false, 'Close must not claim immediate finality')
    await waitFor('circle closure', async () => {
      const r = await request(fetchImpl, path, { token: owner })
      return r.status === 410 && r.value?.error === 'circle_closed'
    })
    const outcome = {
      mode: 'run', pass: true, circleId, writes, marker,
      scope: 'etest_disposable_accounts_only',
      state: 'closed_with_events_retained',
      furtherAction: 'independently_audit_and_scrub_social_events_before_account_deletion',
    }
    write(JSON.stringify(outcome))
    return outcome
  } catch (error) {
    // Intentionally do NOT delete the accounts or assert that Cloud Blob
    // objects have been erased. Even a failed HTTP response may have appended.
    write(JSON.stringify({
      mode: 'run', pass: false, circleId: circleId || null,
      acknowledgedWrites: writes, cleanupCertified: false,
      action: 'retain_test_accounts_and_review_circle_sandbox_before_erasure',
    }))
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const mode = args.length === 1 && args[0] === '--preflight' ? 'preflight'
    : args.length === 1 && args[0] === '--run' ? 'run' : null
  runCircleEtestJourney({ mode }).catch((error) => {
    // Assertion text is intentionally constant/derived from checked status;
    // never dump request objects, headers, stack frames or response bodies.
    console.error('Circle etest journey blocked/failed:', error.message)
    process.exitCode = 1
  })
}
