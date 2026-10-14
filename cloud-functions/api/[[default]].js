/* eslint-env node */
import { getStore } from '@edgeone/pages-blob'
import { checkAuthRateLimit } from '../_shared/auth-rate-limit.js'
import { blocksCircleEtestAccountDeletion, createCircleEtestGateway } from '../_shared/circle/etest-gateway.js'
import { AppError, createBackendService } from '../_shared/core.js'
import { isS2WriteEnabled } from '../_shared/s2-write-gate.js'
import { createEdgeOneBlobStorage } from '../_shared/storage/edgeone-blob.js'
import { commitV4Upload, receiveV4UploadPart } from '../_shared/v4-http-parts.js'

const TRUSTED_FRONTEND_ORIGINS = [
  'https://qwerty-plus.edgeone.dev',
  'https://smhe00.github.io',
]

function numberEnv(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function bearer(request) {
  const value = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(value)

  if (!match) {
    throw new AppError(401, 'missing_token', 'Authorization Bearer token is required')
  }

  return match[1]
}

function corsHeaders(request, configuredOrigin) {
  const origin = request.headers.get('origin') || ''
  if (!origin) return {}

  if (configuredOrigin === '*') {
    return { 'Access-Control-Allow-Origin': '*' }
  }

  const requestOrigin = new URL(request.url).origin
  const allowed = new Set(TRUSTED_FRONTEND_ORIGINS)

  // Same-origin requests are always safe to expose. Keep this behavior for
  // local development and for an EdgeOne custom domain added in the future.
  allowed.add(requestOrigin)

  // CORS_ORIGIN can add explicit origins without removing the two production
  // frontend origins above. "same-origin" remains a supported legacy value.
  if (configuredOrigin && configuredOrigin !== 'same-origin') {
    for (const item of configuredOrigin.split(',')) {
      const value = item.trim()
      if (value) allowed.add(value)
    }
  }

  return allowed.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
}

async function readJson(request, maxBytes) {
  const text = await request.text()

  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new AppError(413, 'request_too_large', 'HTTP request body is too large')
  }

  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    throw new AppError(400, 'invalid_json', 'Request body must contain valid JSON')
  }
}

function logApiError(request, path, error) {
  const fields = {
    event: 'cloud_api_error',
    method: request.method,
    path,
    status: error instanceof AppError ? error.statusCode : 500,
    code: error instanceof AppError ? error.code : 'internal_error',
    errorName: error instanceof Error ? error.name : 'UnknownError',
  }

  const line = JSON.stringify(fields)
  if (fields.status >= 500) console.error(line)
  else console.warn(line)
}

function makeStorage(env) {
  const store = getStore({
    name: env.BLOB_STORE_NAME || 'qwerty-data',
    consistency: 'strong',
  })

  return createEdgeOneBlobStorage(store)
}

function makeService(env, storage) {
  return createBackendService({
    storage,
    sessionTtlSeconds: numberEnv(env.SESSION_TTL_SECONDS, 7 * 24 * 60 * 60),
    maxSyncBytes: numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024),
    multiSessionEnabled: env.MULTI_DEVICE_AUTH_ENABLED === 'true',
    eventPilotEnabled: env.MULTI_DEVICE_EVENT_PILOT_ENABLED === 'true',
  })
}

// V4 GA: authenticated accounts can write by default. Emergency lockdown is
// optional and global. No account-ID allowlist is consulted. The service
// enforces immutable user ownership, payload validation and revision CAS.
async function requireS2WriteAccount(service, request, env) {
  const token = bearer(request)
  // Validate the live session before attempting to parse or stage a payload.
  // Also prevents a revoked/invalid token from reaching any write action.
  const session = await service.me(token)
  if (!session?.user?.userId || typeof session.user.userId !== 'string') {
    throw new AppError(401, 'invalid_session', 'A valid account session is required')
  }
  if (!isS2WriteEnabled(env.S2_SYNC_WRITES_DISABLED)) {
    throw new AppError(503, 's2_writes_temporarily_disabled',
      'Cloud V4 writes are temporarily unavailable')
  }
  return token
}

async function enforceAuthRateLimit(context, storage, env, cors) {
  const clientIp =
    typeof context.clientIp === 'string' ? context.clientIp.trim() : ''

  if (!clientIp) {
    throw new AppError(
      503,
      'client_ip_unavailable',
      'Client IP is unavailable; authentication is temporarily unavailable',
    )
  }

  const result = await checkAuthRateLimit({
    storage,
    clientIp,
    requestLimit: numberEnv(env.AUTH_RATE_LIMIT_REQUESTS, 10),
    windowSeconds: numberEnv(env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 60),
  })

  if (result.allowed) return null

  return json(
    {
      ok: false,
      error: 'auth_rate_limited',
      message: 'Too many authentication attempts; please retry later',
      details: {
        retryAfterSeconds: result.retryAfterSeconds,
      },
    },
    429,
    {
      ...cors,
      'Retry-After': String(result.retryAfterSeconds),
    },
  )
}

export async function onRequest(context) {
  const { request, env = {} } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  const cors = corsHeaders(request, env.CORS_ORIGIN || 'same-origin')

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // The Circle pilot is inert on all non-etest hosts or when not enabled.
  if ((path === '/circle/v2' || path.startsWith('/circle/v2/')) &&
      (url.hostname !== 'etest.edgeone.dev' || env.CIRCLE_ETEST_ENABLED !== 'true')) {
    return json({ ok: false, error: 'not_found' }, 404, cors)
  }

  try {
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return json(
        {
          ok: true,
          service: 'qwerty-sync-gateway',
          apiVersion: 1,
          // Millisecond-resolution, uncached origin execution time. This is
          // an estimate for clock-skew preflight, not a signed event timestamp.
          serverTimeMs: Date.now(),
          authMode: env.MULTI_DEVICE_AUTH_ENABLED === 'true'
            ? 'independent-device-sessions-pilot'
            : 'single-active-session',
          runtime: process.version,
          capabilities: [
            'snapshot-retention-v1',
            'bounded-session-history-v1',
            'bounded-auth-history-v1',
            'trusted-frontend-cors-v2',
            'same-origin-cors-v1',
            'application-auth-rate-limit-v1',
            'application-auth-rate-limit-v2',
            'hybrid-auth-rate-limit-v3',
            'blob-transient-retry-v1',
            'plain-gzip-sync-v2',
            'learning-state-backup-v3',
            'backup-v4-authenticated-write-ga',
            'edgeone-same-origin-e2e-v1',
            'v4-blob-stage-trace-20261014',
            'v4-http-multipart-v1',
             'v4-http-stage-trace-v1',
            'backup-v3-explicit-migration-only',
            'account-delete-v1',
            'duplicate-register-protection-v1',
          ],
        },
        200,
        cors,
      )
    }

    const storage = makeStorage(env)
    const service = makeService(env, storage)
    const bodyLimit =
      Math.ceil(numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024) * 1.5) + 256 * 1024

    if (path === '/circle/v2' || path.startsWith('/circle/v2/')) {
      const result = await createCircleEtestGateway({
        backend: service, getStore, rateStorage: storage,
      }).handle(context)
      for (const [key, value] of Object.entries(cors)) result.headers.set(key, value)
      return result
    }

    if (
      request.method === 'POST' &&
      (path === '/auth/register' || path === '/auth/login')
    ) {
      const limited = await enforceAuthRateLimit(context, storage, env, cors)
      if (limited) return limited
    }

    if (request.method === 'POST' && path === '/auth/register') {
      const body = await readJson(request, 64 * 1024)
      return json(
        {
          ok: true,
          ...(await service.register(body.username, body.password, body.deviceId)),
        },
        201,
        cors,
      )
    }

    if (request.method === 'POST' && path === '/auth/login') {
      const body = await readJson(request, 64 * 1024)
      return json(
        {
          ok: true,
          ...(await service.login(body.username, body.password, body.deviceId)),
        },
        200,
        cors,
      )
    }

    if (request.method === 'GET' && path === '/auth/me') {
      return json({ ok: true, ...(await service.me(bearer(request))) }, 200, cors)
    }

    if (request.method === 'POST' && path === '/auth/logout') {
      return json({ ok: true, ...(await service.revokeSession(bearer(request))) }, 200, cors)
    }

    if (request.method === 'DELETE' && path === '/auth/account') {
      // Until Circle has an audited deletion inventory, refuse deleting
      // explicitly allowlisted pilot identities (no orphaned social events).
      // All non-pilot and production users retain existing V4 semantics.
      if (url.hostname === 'etest.edgeone.dev' &&
          String(env.CIRCLE_ETEST_USER_IDS || '').trim()) {
        const me = await service.me(bearer(request))
        if (blocksCircleEtestAccountDeletion({
          hostname: url.hostname, env, userId: me.user?.userId,
        })) {
          throw new AppError(409, 'circle_etest_deletion_requires_cleanup',
            'Circle test account cleanup must complete before account deletion')
        }
      }
      const body = await readJson(request, 64 * 1024)
      return json(
        {
          ok: true,
          ...(await service.deleteAccount(bearer(request), body.currentPassword)),
        },
        200,
        cors,
      )
    }

    if (request.method === 'POST' && path === '/auth/change-password') {
      const body = await readJson(request, 64 * 1024)
      return json(
        {
          ok: true,
          ...(await service.changePassword(
            bearer(request),
            body.currentPassword,
            body.newPassword,
            body.deviceId,
          )),
        },
        200,
        cors,
      )
    }


    // M3.2: chained per-device history. Does not authorize V4 restore/sync.
    if (request.method === 'POST' && path === '/sync/events/v2') {
      const body = await readJson(request, 110 * 1024)
      return json({ ok: true,
        ...(await service.publishChainedLearningBatch(bearer(request), body)) },
        201, cors)
    }
    if (request.method === 'GET' && path === '/sync/events/v2') {
      const selector = {
        deviceId: url.searchParams.get('deviceId'),
        batchId: url.searchParams.get('batchId'),
        sha256: url.searchParams.get('sha256'),
        sequence: Number(url.searchParams.get('sequence')),
      }
      return json({ ok: true,
        ...(await service.readChainedLearningBatch(bearer(request), selector)) },
        200, cors)
    }
    if (request.method === 'GET' && path === '/sync/events/v2/observed') {
      return json({ ok: true,
        ...(await service.observeChainedLearningReceipts(bearer(request))) }, 200, cors)
    }
    if (request.method === 'POST' && path === '/sync/events/v2/verify') {
      const body = await readJson(request, 8 * 1024)
      return json({ ok: true,
        ...(await service.verifyChainedLearningHistory(bearer(request), body)) },
        200, cors)
    }

    // M3.5: cross-device witnessed prefixes only. Never claims discovery
    // completeness and never authorizes a V4 merge or publication.
    if (request.method === 'POST' && path === '/sync/events/v2/verify-set') {
      const body = await readJson(request, 8 * 1024)
      return json({ ok: true,
        ...(await service.verifyWitnessedChainSet(bearer(request), body)) },
        200, cors)
    }

    // Independent immutable event pilot: separate from old V4 revision writer.
    // There is deliberately no "list complete" or auto-restore endpoint yet.
    if (request.method === 'POST' && path === '/sync/events/v1') {
      const body = await readJson(request, 110 * 1024)
      return json({ ok: true,
        ...(await service.publishLearningBatch(bearer(request), body)) }, 201, cors)
    }
    if (request.method === 'GET' && path === '/sync/events/v1/observed') {
      return json({ ok: true,
        ...(await service.observeLearningBatchReceipts(bearer(request))) }, 200, cors)
    }
    if (request.method === 'GET' && path === '/sync/events/v1') {
      return json({ ok: true,
        ...(await service.readLearningBatch(bearer(request), {
          deviceId: url.searchParams.get('deviceId'),
          batchId: url.searchParams.get('batchId'),
          sha256: url.searchParams.get('sha256'),
        })) }, 200, cors)
    }

    // Bounded HTTP parts avoid the EdgeOne request.text() large-body limit.
    // A part never advances the published V4 revision.
    if (request.method === 'POST' && path === '/sync/v2/parts') {
      const token = await requireS2WriteAccount(service, request, env)
      const account = await service.me(token)
      let body
      try {
        body = await readJson(request, 48 * 1024)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(503, 'v4_upload_body_read_failed',
          'Unable to receive bounded V4 part; retry the identical part')
      }
      return json({ ok: true,
        ...(await receiveV4UploadPart(storage, account.user.userId, body)) },
        200, cors)
    }
    if (request.method === 'POST' &&
        (path === '/sync/v2/commit' || path === '/sync/v2/commit/recovery')) {
      const token = await requireS2WriteAccount(service, request, env)
      const account = await service.me(token)
      const body = await readJson(request, 16 * 1024)
      const recovery = path === '/sync/v2/commit/recovery'
      const maxBytes = numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024)
      return json({ ok: true,
        ...(await commitV4Upload(storage, service, token, account.user.userId,
          body, maxBytes, recovery)) }, 200, cors)
    }

    if (request.method === 'PUT' && path === '/sync/v2/recovery') {
      const token = await requireS2WriteAccount(service, request, env)
      const body = await readJson(request, bodyLimit)
      return json({ ok: true, ...(await service.putSyncV4Recovery(token, body)) }, 200, cors)
    }

    if (request.method === 'PUT' && path === '/sync/v2') {
      const token = await requireS2WriteAccount(service, request, env)
      let body
      try {
        body = await readJson(request, bodyLimit)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(503, 'snapshot_body_read_failed',
          'Unable to receive V4 request; check remote metadata before retry')
      }
      return json({ ok: true, ...(await service.putSyncV4(token, body)) }, 200, cors)
    }

    if (request.method === 'GET' && path === '/sync/v2/meta') {
      return json({ ok: true, ...(await service.syncMeta(bearer(request))) }, 200, cors)
    }

    if (request.method === 'GET' && path === '/sync/v2') {
      return json({ ok: true, ...(await service.getSync(bearer(request))) }, 200, cors)
    }

    if (request.method === 'GET' && path === '/sync/meta') {
      return json({ ok: true, ...(await service.syncMeta(bearer(request))) }, 200, cors)
    }

    if (request.method === 'GET' && path === '/sync') {
      return json({ ok: true, ...(await service.getSync(bearer(request))) }, 200, cors)
    }

    if (request.method === 'PUT' && path === '/sync') {
      throw new AppError(410, 'legacy_sync_retired',
        'Legacy cloud writes are retired; only V4 sync is supported')
    }

    throw new AppError(404, 'not_found', 'Not found')
  } catch (error) {
    logApiError(request, path, error)

    if (error instanceof AppError) {
      return json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          details: error.details || undefined,
        },
        error.statusCode,
        cors,
      )
    }

    return json(
      {
        ok: false,
        error: 'internal_error',
        message: 'Internal server error',
      },
      500,
      cors,
    )
  }
}
