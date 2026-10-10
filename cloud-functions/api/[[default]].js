/* eslint-env node */
import { getStore } from '@edgeone/pages-blob'
import { checkAuthRateLimit } from '../_shared/auth-rate-limit.js'
import { AppError, createBackendService } from '../_shared/core.js'
import { createEdgeOneBlobStorage } from '../_shared/storage/edgeone-blob.js'

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
  })
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

  try {
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return json(
        {
          ok: true,
          service: 'qwerty-sync-gateway',
          apiVersion: 1,
          authMode: 'single-active-session',
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

    if (request.method === 'DELETE' && path === '/auth/account') {
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

    if (request.method === 'PUT' && path === '/sync/v2/recovery') {
      const body = await readJson(request, bodyLimit)
      return json({ ok: true, ...(await service.putSyncV4Recovery(bearer(request), body)) }, 200, cors)
    }

    if (request.method === 'PUT' && path === '/sync/v2') {
      const body = await readJson(request, bodyLimit)
      return json({ ok: true, ...(await service.putSyncV4(bearer(request), body)) }, 200, cors)
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
      const body = await readJson(request, bodyLimit)
      return json({ ok: true, ...(await service.putSync(bearer(request), body)) }, 200, cors)
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
