/* eslint-env node */
import { randomBytes } from 'node:crypto'
import { retrySafeBodyRequest } from '../../cloud-functions/_shared/safe-body-retry.js'

/** Exactly one deletion operation. Unknown outcome is resolved by read-only
 * proof, never by logging in again or resending a possibly committed DELETE. */
export async function cleanupDisposableAccount({ baseUrl, username, password, userId,
  token, fetchImpl = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  authTimeoutMs = 60000, deleteTimeoutMs = 60000, recoveryMs = 120000, pollMs = 1500, onEvent = () => {},
}) {
  const origin = new URL(baseUrl).origin
  if (!['https://t.smhe.cn', 'https://q.smhe.cn', 'https://qwerty-plus.edgeone.dev'].includes(origin) ||
      typeof username !== 'string' || !/^(?:e2e_|v4_ga_)[a-z0-9_-]+$/i.test(username) ||
      typeof password !== 'string' || password.length < 4 ||
      (userId !== undefined && !/^[a-f0-9]{32}$/.test(userId)))
    throw new Error('Refusing cleanup without exact disposable identity')
  const trace = [], start = now()
  function event(value) { const item = { ...value, elapsedMs: now() - start }; trace.push(item); onEvent(item) }
  const fail = message => Object.assign(new Error(message), { trace })
  async function request(path, method = 'GET', body, bearer, timeout = 30000) {
    const phase = path.includes('deletion-status') ? 'receipt-read' : method === 'DELETE' ? 'delete' : 'owner-check'
    try {
      const response = await fetchImpl(origin + path, { method, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
      const result = await response.json().catch(() => null)
      event({ phase,
        status: response.status, ...(typeof result?.error === 'string' ? { code: result.error } : {}) })
      return { status: response.status, body: result }
    } catch (error) {
      event({ phase, errorType: error?.name || 'Error' })
      error.trace = trace
      throw error
    }
  }
  const identityMatches = body => body?.user?.username === username && /^[a-f0-9]{32}$/.test(body?.user?.userId || '') &&
    (!userId || body.user.userId === userId)
  let owner
  if (token) {
    const me = await request('/api/auth/me', 'GET', undefined, token, authTimeoutMs)
    if (me.status === 200) {
      if (!identityMatches(me.body)) throw fail('Disposable cleanup bearer owner mismatch')
      owner = me.body.user.userId
    } else if (me.status !== 401) throw fail('Disposable cleanup owner could not be verified')
  }
  if (!owner) {
    const signed = await retrySafeBodyRequest(() => request('/api/auth/login', 'POST', {
      username, password, deviceId: 'ci-disposable-cleanup',
    }, undefined, authTimeoutMs), { path: '/api/auth/login', method: 'POST', pause: () => pause(250) })
    if (signed.status !== 200 || !identityMatches(signed.body) || typeof signed.body.token !== 'string')
      throw fail('Disposable cleanup authentication unverified; no deletion')
    owner = signed.body.user.userId; token = signed.body.token
  }
  const operationId = randomBytes(16).toString('hex')
  let answer
  try {
    answer = await retrySafeBodyRequest(() => request('/api/auth/account', 'DELETE', {
      currentPassword: password, operationId,
    }, token, deleteTimeoutMs), { path: '/api/auth/account', method: 'DELETE', pause: () => pause(250) })
  } catch { /* Read outcome below. Do not recreate a session or repeat DELETE. */ }
  if (answer?.status === 200 && answer.body?.ok === true && answer.body.operationId === operationId &&
      answer.body.deleted?.accountDeleted === true) {
    return { confirmed: true, via: 'delete-response', elapsedMs: now() - start, trace,
      server: { elapsedMs: answer.body.deleted.elapsedMs, stages: answer.body.deleted.stages } }
  }
  const deadline = now() + recoveryMs
  let lastState = 'unknown'
  do {
    try {
      const proof = await request('/api/auth/account/deletion-status?operationId=' + operationId,
        'GET', undefined, token, Math.max(1, Math.min(30000, deadline - now())))
      if (proof.status === 200) {
        if (proof.body?.ok !== true || proof.body.operationId !== operationId || proof.body.userId !== owner)
          throw fail('Deletion receipt identity mismatch')
        lastState = proof.body.state
        if (lastState === 'completed' && proof.body.deleted?.accountDeleted === true)
          return { confirmed: true, via: 'receipt', elapsedMs: now() - start, trace,
            server: { elapsedMs: proof.body.deleted.elapsedMs, stages: proof.body.deleted.stages } }
        if (lastState !== 'pending') throw fail('Deletion receipt state invalid')
      } else if (proof.status === 410) break
      else if (proof.status !== 404 && proof.status < 500 && proof.status !== 429)
        throw fail('Deletion receipt access rejected')
      // An explicit rejected DELETE plus missing receipt is a failed operation,
      // not a deleted account and not permission to delete with another token.
      if (proof.status === 404 && answer?.status >= 400 && answer.status < 500) break
    } catch (error) {
      if (/identity mismatch|state invalid|access rejected/.test(error.message)) throw error
    }
    if (now() >= deadline) break
    await pause(Math.min(pollMs, deadline - now()))
  } while (now() < deadline)
  const failure = new Error('Disposable cleanup outcome unconfirmed: ' + lastState + '; no DELETE replay')
  failure.trace = trace
  throw failure
}
