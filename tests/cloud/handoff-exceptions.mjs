/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { fixture } from './session-handoff-fixtures.mjs'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'
import { guardedPrewriteRetry } from './session-handoff-safe-retry.mjs'

const capability = 'account-handoff-blob-fixtures-v1'
const origin = 'https://t.smhe.cn'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const code = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : null
const counters = data => Object.fromEntries(['operations', 'pendingHandoffs', 'activeWriters', 'heldWriters', 'unresolved']
  .filter(key => Number.isSafeInteger(data?.[key]) && data[key] >= 0).map(key => [key, data[key]]))

// Same fixed staging endpoint, runtime and assertions in local/CI qualification.
// A test may inject transport; callers cannot supply an existing account/token.
// No runtime modifications, forced unlocks, storage deletes or credential logs.
export async function qualifyExceptionalHandoff({ fetchImpl = globalThis.fetch, sourceSha = null } = {}) {
  const username = 'qh26' + crypto.randomBytes(12).toString('hex')
  const password = crypto.randomBytes(24).toString('hex')
  const report = { scope: 'one-new-disposable-account', sourceSha, productionTouched: false,
    runtimeModified: false, checks: [], responses: [], checkpoints: [], prewriteRetries: 0,
    intentionallyAbortedWrites: 0, abortedWriteReplays: 0, cleanup: 'not-started', passed: false }
  let token, accountId, safeToCleanup = true, stage = 'health'
  const jobs = []
  const task = promise => {
    const state = { settled: false, value: null, error: null }
    state.promise = promise.then(value => { state.value = value; state.settled = true; return value },
      error => { state.error = error; state.settled = true; return null })
    jobs.push(state)
    return state
  }
  const check = (name, condition) => {
    assert.ok(condition, name)
    report.checks.push({ name, passed: true })
  }
  async function call(path, { method = 'GET', bearer, body, bytes, headers = {}, signal } = {}) {
    const target = new URL('/api' + path, origin)
    const started = performance.now()
    const result = await fetchImpl(target, { method, cache: 'no-store', redirect: 'error',
      headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(bytes ? { body: bytes } : body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) })
    let data
    try { data = await result.json() } catch { throw new Error('non_json_response') }
    const guarded = result.headers.get('x-qwerty-handoff')
    const evidence = { method, path, status: result.status, error: code(data?.error),
      guarded: guarded === capability, durationMs: Math.round(performance.now() - started) }
    if (path === '/auth/handoff/status') evidence.counters = counters(data)
    if (report.responses.length < 180) report.responses.push(evidence)
    return { status: result.status, data, guarded }
  }
  const login = (deviceId, secret = password) => call('/auth/login', { method: 'POST',
    body: { username, password: secret, deviceId } })
  const status = async bearer => {
    const response = await call('/auth/handoff/status', { bearer })
    check('authenticated coordination status is available', response.status === 200)
    return response.data
  }
  const payload = (words, revision) => {
    const value = fixture(accountId, words, revision)
    verifyCompressedV4(value.payloadBytes, accountId, value.logicalFingerprint)
    return value
  }
  const upload = (bearer, value, { hold = 0, signal, priorSha = null } = {}) => guardedPrewriteRetry({
    send: () => {
      if (signal?.aborted) report.abortedWriteReplays++
      return call('/sync/v2/binary/direct', { method: 'POST', bearer, bytes: value.payloadBytes, signal,
      headers: { 'Content-Type': 'application/octet-stream',
        'X-Qwerty-Base-Revision': String(value.baseRevision),
        'X-Qwerty-Logical-Fingerprint': value.logicalFingerprint,
        'X-Qwerty-Payload-Sha256': sha(value.payloadBytes),
        ...(hold ? { 'X-Qwerty-Handoff-Hold-Ms': String(hold) } : {}) } })
    },
    verifyUnchanged: async () => {
      const current = await call('/sync/v2/meta', { bearer })
      return current.status === 200 && current.guarded === capability &&
        current.data.revision === value.baseRevision && current.data.dataSha256 === priorSha
    },
    onRetry: () => { report.prewriteRetries++ },
  })
  async function checkpoint(bearer, predicate, watching = []) {
    for (let count = 0; count < 20; count++) {
      if (watching.some(job => job.settled)) throw new Error('required_overlap_not_exercised')
      const response = await call('/auth/handoff/status', { bearer })
      if (response.status !== 200) throw new Error('checkpoint_unavailable')
      if (predicate(response.data)) {
        report.checkpoints.push({ stage, ...counters(response.data) })
        return response.data
      }
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    throw new Error('required_overlap_not_exercised')
  }
  async function exact(bearer, value, revision, name) {
    const current = await call('/sync/v2/meta', { bearer })
    check(name, current.status === 200 && current.guarded === capability &&
      current.data.revision === revision && current.data.dataSha256 === sha(value.payloadBytes) &&
      current.data.logicalFingerprint === value.logicalFingerprint)
  }
  try {
    const health = await call('/health')
    check('deployed fixture-only handoff capability', health.status === 200 &&
      health.data.capabilities?.includes(capability) && health.data.handoffProductionReady === false)
    const policy = await call('/account-policy')
    check('executing global cleanup remains disabled', policy.status === 200 && policy.data.executionEnabled === false)
    stage = 'register'
    const registered = await call('/auth/register', { method: 'POST', body: { username, password, deviceId: 'exception-A' } })
    check('new synthetic account registered under protection', registered.status === 201 && registered.guarded === capability)
    token = registered.data.token; accountId = registered.data.user.userId
    stage = 'incorrect-password'
    const before = await status(token)
    const denied = await login('incorrect-password', 'incorrect-' + password)
    check('incorrect password is rejected before takeover', denied.status === 401 && denied.data.error === 'incorrect_password')
    const after = await status(token)
    check('incorrect password creates no pending operation or session change',
      after.operations === before.operations && after.unresolved === 0 && after.pendingHandoffs === 0)
    check('A remains authenticated after rejected takeover', (await call('/auth/me', { bearer: token })).status === 200)

    stage = 'disconnected-writer'
    const aToken = token, alpha = payload(['alpha'], 0), controller = new AbortController()
    safeToCleanup = false
    const a = task(upload(aToken, alpha, { hold: 5000, signal: controller.signal }))
    await checkpoint(aToken, s => s.heldWriters === 1 && s.activeWriters === 1, [a])
    const b = task(login('exception-B'))
    await checkpoint(aToken, s => s.pendingHandoffs === 1 && s.heldWriters === 1 && s.activeWriters === 1, [a, b])
    controller.abort()
    report.intentionallyAbortedWrites++
    await a.promise
    check('client disconnect loses A response rather than reporting success', a.error?.name === 'AbortError')
    const bResult = await b.promise
    check('B completes guarded takeover after disconnected A', !b.error && bResult?.status === 200 && bResult.guarded === capability)
    token = bResult.data.token
    await exact(token, alpha, 1, 'B preserves exact A payload despite losing A HTTP response')
    const lateA = await upload(aToken, payload(['late-A'], 1), { priorSha: sha(alpha.payloadBytes) })
    check('disconnected A cannot replay with stale credentials', lateA.status === 401 && lateA.data.error === 'session_revoked')

    stage = 'two-pending-takeovers'
    const bToken = token, union = payload(['alpha', 'beta'], 1)
    const writer = task(upload(bToken, union, { hold: 5000, priorSha: sha(alpha.payloadBytes) }))
    await checkpoint(bToken, s => s.heldWriters === 1 && s.activeWriters === 1, [writer])
    const c = task(login('exception-C')), d = task(login('exception-D'))
    await checkpoint(bToken, s => s.pendingHandoffs === 2 && s.activeWriters === 1 && s.heldWriters === 1, [writer, c, d])
    check('two takeovers genuinely overlap an unfinished writer', true)
    const [written, cResult, dResult] = await Promise.all([writer.promise, c.promise, d.promise])
    check('writer and both serialized takeovers finish successfully', !writer.error && !c.error && !d.error &&
      written?.status === 200 && cResult?.status === 200 && dResult?.status === 200 &&
      cResult.guarded === capability && dResult.guarded === capability)
    // Network completion order does not establish service commit order.
    const cMe = await call('/auth/me', { bearer: cResult.data.token })
    const dMe = await call('/auth/me', { bearer: dResult.data.token })
    check('exactly one competing login remains valid',
      (cMe.status === 200 && dMe.status === 401 && dMe.data.error === 'session_revoked') ||
      (dMe.status === 200 && cMe.status === 401 && cMe.data.error === 'session_revoked'))
    token = cMe.status === 200 ? cResult.data.token : dResult.data.token
    await exact(token, union, 2, 'winning contender sees both records and exact fingerprint')
    check('previous writer loses authority after competing takeovers',
      (await call('/auth/me', { bearer: bToken })).status === 401)

    stage = 'repeated-switch'
    for (const device of ['exception-E', 'exception-F']) {
      const old = token, next = await login(device)
      check('subsequent takeover returns a guarded session', next.status === 200 && next.guarded === capability)
      token = next.data.token
      check('previous session is revoked after sequential takeover', (await call('/auth/me', { bearer: old })).status === 401)
      await exact(token, union, 2, 'repeated switching preserves the same cloud revision')
    }
    stage = 'logout-relogin'
    const old = token
    const out = await call('/auth/logout', { method: 'POST', bearer: token })
    check('logout completes under the guard', out.status === 200 && out.guarded === capability && out.data.revoked === true)
    check('logged-out token cannot mutate or authenticate', (await call('/auth/me', { bearer: old })).status === 401)
    token = null
    const next = await login('exception-G')
    check('relogin after confirmed logout succeeds', next.status === 200 && next.guarded === capability)
    token = next.data.token
    await exact(token, union, 2, 'final relogin retains both records')
    const settled = await status(token)
    check('all completed operations drained without force-unlock', settled.unresolved === 0 && settled.activeWriters === 0 && settled.pendingHandoffs === 0)
    check('lost-response upload was never resubmitted', report.abortedWriteReplays === 0 && report.intentionallyAbortedWrites === 1)
    safeToCleanup = true
    report.passed = true
  } catch (error) {
    report.failure = { stage, kind: error instanceof assert.AssertionError ? 'assertion' : 'exception',
      detail: error instanceof assert.AssertionError ? error.message : code(error.message) || 'unclassified' }
  } finally {
    await Promise.all(jobs.map(job => job.promise))
    if (token && safeToCleanup) {
      try {
        const result = await call('/auth/account', { method: 'DELETE', bearer: token, body: { currentPassword: password } })
        report.cleanup = result.status === 200 && result.guarded === capability ? 'synthetic-account-deleted' : 'refused'
      } catch { report.cleanup = 'unknown' }
      if (report.cleanup !== 'synthetic-account-deleted') report.passed = false
    } else if (accountId) report.cleanup = 'retained-uncertain-fixture-no-force-unlock'
  }
  report.coordinatorReceiptsRetained = true
  return report
}
