/* eslint-env node */
/* global Response */
import { getStore } from '@edgeone/pages-blob'
import { AppError, createBackendService } from '../_shared/core.js'
import { createEdgeOneBlobStorage } from '../_shared/storage/edgeone-blob.js'

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

  if (!configuredOrigin || configuredOrigin === '*') {
    return { 'Access-Control-Allow-Origin': '*' }
  }

  const allowed = configuredOrigin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return allowed.includes(origin)
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

function makeService(env) {
  const store = getStore({
    name: env.BLOB_STORE_NAME || 'qwerty-data',
    consistency: 'strong',
  })

  return createBackendService({
    storage: createEdgeOneBlobStorage(store),
    sessionTtlSeconds: numberEnv(env.SESSION_TTL_SECONDS, 7 * 24 * 60 * 60),
    maxSyncBytes: numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024),
  })
}

export async function onRequest(context) {
  const { request, env = {} } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  const cors = corsHeaders(request, env.CORS_ORIGIN || '*')

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
        },
        200,
        cors,
      )
    }

    const service = makeService(env)
    const bodyLimit =
      Math.ceil(numberEnv(env.MAX_SYNC_BYTES, 4 * 1024 * 1024) * 1.5) + 256 * 1024

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

    console.error('Unhandled cloud API error:', error)
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
