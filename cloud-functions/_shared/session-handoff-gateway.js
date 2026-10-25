/* eslint-env node */
import { createHash } from 'node:crypto'
import { receiveHandoffAuthBody } from './session-handoff-auth-body.js'
import { AppError, createBackendService, normalizeUsername } from './core.js'
import { createEdgeOneBlobStorage } from './storage/edgeone-blob.js'
import { checkAuthRateLimit } from './auth-rate-limit.js'
import { runtimeEnvironment } from './runtime-environment.js'
import { BeforeMutationError, HandoffError } from './session-handoff-barrier.js'
import { createBlobHandoffBarrier } from './session-handoff-blob.js'
import { getStore, markHandoffRateLimited, rawHandoffStore, runHandoffScope } from './session-handoff-context.js'

// NEW disposable accounts only. No Origin/Host/env/header is an enable switch:
// Maker rewrites Request.url and different domains may share one namespace.
// This branch is staged ONLY to etest, never to production. A distinct fixed
// prefix isolates the rollout from old unguarded instances and existing users.
export const HANDOFF_FIXTURE_USERNAME = /^qh26[0-9a-f]{24}$/
export const HANDOFF_CAPABILITY = 'account-handoff-blob-fixtures-v1'
const digest = text => createHash('sha256').update(text).digest('hex')
const tokenHash = token => /^qs1\.([a-f0-9]{64})\.[A-Za-z0-9_-]{40,64}$/.exec(token || '')?.[1]
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
})

export async function withHandoffGateway(context, dispatch) {
  const { request } = context
  const env = runtimeEnvironment(context.env)
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  if (request.method === 'OPTIONS') return dispatch(context)
  if (request.method === 'GET' && ['/', '/health'].includes(path)) {
    const original = await dispatch(context)
    if (!original.ok) return original
    const data = await original.json()
    data.capabilities = [...(data.capabilities || []), HANDOFF_CAPABILITY]
    data.handoffMode = 'reserved-disposable-accounts-only'
    data.handoffProductionReady = false
    return new Response(JSON.stringify(data), { status: original.status, headers: original.headers })
  }
  try {
    const store = rawHandoffStore({ name: env.BLOB_STORE_NAME || 'qwerty-data', consistency: 'strong' })
    const storage = createEdgeOneBlobStorage(store)
    const quiet = createBackendService({ storage, handoffPreflight: true })
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
    let accountHash, validate, kind = 'writer'
    if (request.method === 'POST' && ['/auth/login', '/auth/register'].includes(path)) {
      const length = request.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > 64 * 1024)) {
        throw new AppError(413, 'request_too_large', 'Authentication request exceeds limit')
      }
      let bytes, body
      try { bytes = await receiveHandoffAuthBody(request) }
      catch {
        // Unknown classification must NOT fall through to the unguarded login.
        // A second body read could succeed and otherwise bypass the barrier.
        // Classification has not entered admission/account business. Preserve
        // the existing, narrowly scoped one-fresh-request retry certificate.
        throw new AppError(503, 'request_body_unavailable', 'Unable to receive request content; please retry',
          { stage: 'request-body', safeToRetry: true })
      }
      if (bytes.byteLength > 64 * 1024) {
        throw new AppError(413, 'request_too_large', 'Authentication request exceeds limit')
      }
      if (length !== null && Number(length) !== bytes.byteLength) {
        throw new AppError(400, 'invalid_json', 'Authentication request length mismatch')
      }
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      catch { throw new AppError(400, 'invalid_json', 'Invalid authentication request') }
      const normalized = normalizeUsername(body?.username).normalizedUsername
      if (!HANDOFF_FIXTURE_USERNAME.test(normalized)) return dispatch(context)
      accountHash = digest(normalized)
      kind = 'handoff'
      // Preserve the existing brute-force protection BEFORE password preflight.
      // The private WeakSet only prevents duplicate counting in the old router.
      if (typeof context.clientIp !== 'string' || !context.clientIp.trim()) {
        throw new AppError(503, 'client_ip_unavailable', 'Client IP unavailable')
      }
      const bounded = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
      const limit = await checkAuthRateLimit({ storage, clientIp: context.clientIp.trim(),
        requestLimit: bounded(env.AUTH_RATE_LIMIT_REQUESTS, 10),
        windowSeconds: bounded(env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 60) })
      markHandoffRateLimited(context)
      if (!limit.allowed) throw new AppError(429, 'auth_rate_limited', 'Please retry later')
      validate = () => path === '/auth/login'
        ? quiet.preflightLogin(body.username, body.password)
        : quiet.preflightRegister(body.username, body.password)
    } else {
      accountHash = tokenHash(bearer)
      if (!accountHash) return dispatch(context)
      const identity = await storage.getAccount(accountHash)
      if (!HANDOFF_FIXTURE_USERNAME.test(identity?.normalizedUsername || '')) return dispatch(context)
      validate = () => quiet.preflightToken(bearer)
      if (['/auth/change-password', '/auth/logout', '/auth/account'].includes(path)) kind = 'handoff'
    }
    // This is a deliberately bounded account-flow qualification, not an
    // unreviewed global-maintenance or social-write rollout.
    if (/^\/(circle|admin|maintenance)(\/|$)/.test(path)) {
      throw new AppError(403, 'handoff_fixture_route_disabled', 'This route is outside account handoff qualification')
    }
    if (env.IDLE_CLEANUP_EXECUTE === 'true') {
      throw new AppError(503, 'handoff_maintenance_isolation_required', 'Disable executing idle maintenance for this qualification')
    }
    const before = await validate()
    if (before.accountHash !== accountHash) throw new HandoffError('handoff_invalid_principal')
    const barrier = createBlobHandoffBarrier({ store: rawHandoffStore({
      name: 'qwerty-handoff-qualification', consistency: 'strong' }) })
    // Read-only, bearer-authenticated fixture diagnostics: no idle touch and no
    // barrier admission. It must remain usable while the writer is draining.
    if (path === '/auth/handoff/status' && request.method === 'GET') {
      return response({ ok: true, ...await barrier.status(accountHash) })
    }
    const rawHold = request.headers.get('x-qwerty-handoff-hold-ms')
    const holdMs = rawHold === null ? 0 : Number(rawHold)
    if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 5000) {
      throw new AppError(400, 'invalid_handoff_test_delay', 'Invalid fixture delay')
    }
    return await barrier.execute(accountHash, kind, async controls => {
      try {
        const current = await validate()
        if (current.accountHash !== before.accountHash || current.accountId !== before.accountId) {
          throw new HandoffError('handoff_identity_changed')
        }
      } catch (error) { throw new BeforeMutationError(error) }
      // All legacy gateway paths now use the tracked getStore. Multipart
      // staging, final publication, cleanup and activity writes share ownership.
      const result = await runHandoffScope({ holdMs, markHeld: controls.markHeld, certifyStopped: true }, async () => {
        if (request.method === 'POST' && path === '/auth/logout') {
          const bound = createEdgeOneBlobStorage(getStore({
            name: env.BLOB_STORE_NAME || 'qwerty-data', consistency: 'strong' }))
          const hash = digest(bearer)
          await bound.revokeSessionToken(accountHash, hash)
          if ((await bound.getSessionRevocation(accountHash, hash))?.revoked !== true) {
            throw new HandoffError('handoff_logout_unverified')
          }
          return response({ ok: true, revoked: true })
        }
        return dispatch(context)
      })
      result.headers.set('X-Qwerty-Handoff', HANDOFF_CAPABILITY)
      return result
    })
  } catch (error) {
    // Never silently fall back to the old router after selection. Unknown
    // credentials/Blob outcome can only fail the request, not grant takeover.
    if (error instanceof AppError || error instanceof HandoffError) {
      if (error.code === 'request_body_unavailable') {
        const rawId = context.uuid
        const requestId = typeof rawId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(rawId) ? rawId : undefined
        return response({ ok: false, error: error.code, message: error.message,
          details: { stage: 'request-body', safeToRetry: true }, requestId }, error.statusCode)
      }
      return response({ ok: false, error: error.code, message: error.message }, error.statusCode)
    }
    return response({ ok: false, error: 'handoff_state_unavailable',
      message: 'Account handoff could not be verified; no takeover was authorized' }, 503)
  }
}
