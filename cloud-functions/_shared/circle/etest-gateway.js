/* eslint-env node */
import { AppError } from '../core.js'
import { checkAuthRateLimit } from '../auth-rate-limit.js'
import { createCircleEventualAssembly } from './assembly.js'

const HOST = 'etest.edgeone.dev'
const STORE = 'qwerty-circle-sandbox'
const SAFE_USER_ID = /^[A-Za-z0-9_-]{8,128}$/
const KEY = /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/

function response(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

/**
 * Separately gated, TEST ACCOUNT ONLY Cloud Function adapter.
 * This factory has no side effects until handle() is called, and returns a
 * closed 404 on non-etest hosts or without the explicit environment switch.
 * No production qwerty-data Circle writes, public object URLs or KV.
 *
 * EdgeOne context.clientIp MUST be trusted; never read client supplied headers.
 * Rate limits are bounded best-effort under non-atomic Blob storage, NOT a
 * globally exact counter. No rate limit is part of membership correctness.
 */
export function createCircleEtestGateway({ backend, getStore, rateStorage } = {}) {
  if (typeof backend?.me !== 'function' || typeof getStore !== 'function' || !rateStorage) {
    throw new TypeError('Circle etest requires real V4 session, Blob factory and limiter storage')
  }
  return Object.freeze({
    async handle(context) {
      const request = context?.request
      if (!request?.url) return response(404, 'not_found')
      const url = new URL(request.url)
      const env = context?.env || {}
      if (url.hostname !== HOST || env.CIRCLE_ETEST_ENABLED !== 'true') {
        return response(404, 'not_found')
      }
      const allow = String(env.CIRCLE_ETEST_USER_IDS || '').split(',')
        .map((id) => id.trim()).filter(Boolean)
      if (env.CIRCLE_ETEST_BLOB_STORE !== STORE ||
          typeof env.CIRCLE_ETEST_INVITE_KEY !== 'string' ||
          env.CIRCLE_ETEST_INVITE_KEY.length < 32 ||
          allow.length < 1 || allow.length > 16 || allow.some((id) => !SAFE_USER_ID.test(id))) {
        return response(503, 'circle_etest_not_configured')
      }
      const clientIp = typeof context.clientIp === 'string' ? context.clientIp.trim() : ''
      if (!clientIp || clientIp.length > 128) return response(503, 'circle_client_ip_unavailable')
      try {
        // Test environment only: always use the explicitly named isolated Store.
        // Never reuse the production V4 backup store as a Circle default.
        const store = getStore({ name: STORE, consistency: 'strong' })
        const scopedBlob = Object.freeze({
          async setJSON(key, event) {
            if (!KEY.test(key)) throw new Error('Circle write key out of scope')
            return store.setJSON(key, event)
          },
          async get(key, options) {
            if (!KEY.test(key)) throw new Error('Circle read key out of scope')
            return store.get(key, { ...options, consistency: 'strong' })
          },
          async list(options) {
            if (typeof options?.prefix !== 'string' ||
                !/^social\/v2\/circles\/[a-f0-9]{24}\/events\/$/.test(options.prefix)) {
              throw new Error('Circle list prefix out of scope')
            }
            return store.list({ ...options, consistency: 'strong' })
          },
        })
        const allowedIds = new Set(allow)
        const limiter = async ({ token }) => {
          const ipBudget = await checkAuthRateLimit({
            storage: rateStorage, clientIp: 'circle-ip:' + clientIp,
            requestLimit: 60, windowSeconds: 60,
          })
          if (!ipBudget.allowed) return false
          let user
          try { user = await backend.me(token) }
          catch (error) {
            if (error instanceof AppError && error.statusCode === 401) throw error
            throw new AppError(503, 'circle_session_unavailable', 'Circle session unavailable')
          }
          const userId = user?.user?.userId
          if (!SAFE_USER_ID.test(userId || '')) {
            throw new AppError(401, 'invalid_session', 'Valid session required')
          }
          // A dedicated test account allowlist bounds the pilot's privacy scope.
          if (!allowedIds.has(userId)) {
            throw new AppError(403, 'circle_etest_account_denied', 'Not a Circle test account')
          }
          const accountBudget = await checkAuthRateLimit({
            storage: rateStorage, clientIp: 'circle-account:' + userId,
            requestLimit: 60, windowSeconds: 60,
          })
          return accountBudget.allowed
        }
        return await createCircleEventualAssembly({
          backend, blobStore: scopedBlob, limit: limiter,
          inviteKey: env.CIRCLE_ETEST_INVITE_KEY, maxEvents: 2000,
        }).transport.handle(request)
      } catch {
        return response(503, 'circle_etest_unavailable')
      }
    },
  })
}
