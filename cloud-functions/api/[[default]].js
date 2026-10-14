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

// EdgeOne Maker has repeatedly failed request.body.getReader().read()
// at 192 KiB even when 32 KiB succeeds. Use the standard Request.arrayBuffer()
// receive path, then validate the declared 512-KiB size (no Base64 conversion).
// The Content-Length bound is checked before receiving when available.
// This changes the body primitive, NOT the request timeout, part size,
// revision CAS, immutable SHA evidence, or binary Blob layout.
async function readBinaryPart(request, maxBytes) {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > maxBytes)) {
    throw new AppError(413, 'request_too_large', 'V4 binary part exceeds limit')
  }
  const arrayBuffer = await request.arrayBuffer()
  if (!arrayBuffer.byteLength || arrayBuffer.byteLength > maxBytes) {
    throw new AppError(413, 'request_too_large', 'V4 binary part outside limit')
  }
  if (declaredLength !== null && Number(declaredLength) !== arrayBuffer.byteLength) {
    throw new AppError(400, 'invalid_v4_upload_part', 'Binary part declared length mismatch')
  }
  return Buffer.from(arrayBuffer)
}

// Legacy master V4 JSON PUT remains the migration fixture input.
// EdgeOne's request.text() intermittently fails even for small valid bodies.
// Receive bounded UTF-8 JSON through the same proven arrayBuffer primitive
// used by native binary parts. This does NOT encode gzip as Base64 on S2.
async function readLegacyV4Json(request, maxBytes) {
  const length = request.headers.get('content-length')
  if (length !== null &&
      (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new AppError(413, 'request_too_large', 'Legacy V4 JSON body exceeds limit')
  }
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > maxBytes) {
    throw new AppError(413, 'request_too_large', 'Legacy V4 JSON body exceeds limit')
  }
  if (length !== null && Number(length) !== bytes.byteLength) {
    throw new AppError(400, 'invalid_json', 'Legacy V4 JSON length mismatch')
  }
  if (!bytes.byteLength) return {}
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new AppError(400, 'invalid_json', 'Request body must contain valid JSON')
  }
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
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Qwerty-Payload-Sha256,X-Qwerty-Part-Sha256,X-Qwerty-Part-Index,X-Qwerty-Part-Count',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // No Circle store/session initialization on production and unenabled hosts.
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
            'v4-http-binary-192k-v1',
            'v4-end-to-end-binary-v1',
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

    // Only the explicit etest pilot can reach the Circle Cloud Function.
    // The Circle Store is isolated from the V4 backup namespace.
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
      // Keep pilot Circle identities undeletable until an auditable scrub,
      // even after the pilot flag is disabled. All other V4 accounts unchanged.
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
      const contentType = request.headers.get('content-type')?.split(';')[0]
        .trim().toLowerCase()
      try {
        if (contentType === 'application/octet-stream') {
          const indexHeader = request.headers.get('x-qwerty-part-index')
          const countHeader = request.headers.get('x-qwerty-part-count')
          const declaredChunk = request.headers.get('x-qwerty-chunk-bytes')
          const wirePartBytes = 512 * 1024
          if (declaredChunk !== String(wirePartBytes)) {
            throw new AppError(400, 'invalid_v4_upload_part',
              'Binary V4 requires 512-KiB HTTP parts')
          }
          // Reject malformed metadata without trusting parseInt's prefix parsing.
          if (!/^\d+$/.test(indexHeader || '') || !/^\d+$/.test(countHeader || '')) {
            throw new AppError(400, 'invalid_v4_upload_part', 'Invalid binary part selector')
          }
          body = {
            payloadSha256: request.headers.get('x-qwerty-payload-sha256'),
            partSha256: request.headers.get('x-qwerty-part-sha256'),
            index: Number(indexHeader), count: Number(countHeader),
            wirePartBytes, data: await readBinaryPart(request, wirePartBytes),
          }
          // 192 parts was the old 32-KiB transport limit, not permission to
          // stage ~36 MiB when this account's max compressed gzip is 4 MiB.
          const maxBytes = numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024)
          if (body.count > Math.ceil(maxBytes / body.wirePartBytes) ||
              (body.index === body.count - 1 &&
                (body.count - 1) * body.wirePartBytes + body.data.length > maxBytes)) {
            throw new AppError(413, 'request_too_large',
              'V4 binary upload exceeds compressed account quota')
          }
        } else if (contentType === 'application/json') {
          // Compatibility for open tabs using legacy 32-KiB Base64 JSON parts.
          body = await readJson(request, 48 * 1024)
        } else {
          throw new AppError(415, 'unsupported_v4_part_encoding',
            'V4 parts must use octet-stream or legacy JSON')
        }
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
        body = await readLegacyV4Json(request, bodyLimit)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError(503, 'snapshot_body_read_failed',
          'Unable to receive V4 request; check remote metadata before retry')
      }
      return json({ ok: true, ...(await service.putSyncV4(token, body)) }, 200, cors)
    }

    // Authenticated pinned binary download; every part comes directly from
    // the immutable native Blob object and is SHA checked before response.
    if (request.method === 'GET' && path === '/sync/v2/binary/manifest') {
      return json({ ok: true,
        ...(await service.getSyncV4BinaryManifest(bearer(request))) }, 200, cors)
    }
    if (request.method === 'GET' && path === '/sync/v2/binary/part') {
      const revisionParam = url.searchParams.get('revision') || ''
      const indexParam = url.searchParams.get('index') || ''
      if (!/^\d+$/.test(revisionParam) || !/^\d+$/.test(indexParam)) {
        throw new AppError(400, 'invalid_binary_part_selector',
          'Binary revision and part index must be decimal integers')
      }
      const bytes = await service.getSyncV4BinaryPart(bearer(request),
        Number(revisionParam), url.searchParams.get('sha') || '', Number(indexParam))
      return new Response(bytes, { status: 200, headers: {
        ...cors, 'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.length), 'Cache-Control': 'no-store',
      } })
    }
    if (request.method === 'POST' && path === '/sync/v2/binary/migrate') {
      const token = await requireS2WriteAccount(service, request, env)
      const expected = await readJson(request, 4 * 1024)
      return json({ ok: true,
        ...(await service.migrateSyncV4Binary(token, expected)) }, 200, cors)
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
