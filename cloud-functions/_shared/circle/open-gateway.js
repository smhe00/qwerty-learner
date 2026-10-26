/* eslint-env node */
import { timeCircleStage } from './profile.js'
import { AppError } from '../core.js'
import { checkAuthRateLimit } from '../auth-rate-limit.js'
import { createCircleEventualAssembly } from './assembly.js'
import { createCircleV3Storage } from './bounded-storage.js'
import { createCircleBoundedService } from './bounded-service.js'
import { createCircleTransport } from './transport.js'

const SAFE_USER_ID = /^[A-Za-z0-9_-]{8,128}$/
const KEY = /^social\/v2\/circles\/[a-f0-9]{24}\/events\/[a-f0-9]{32}\.json$/

function response(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}


/**
 * Open authenticated Circle API. No Maker environment activation, test
 * user allowlist or second Blob Store is required.
 * Physically isolated key prefixes within the existing private V4 Blob
 * Store prevent touching V4 account, session or backup objects.
 * The server's V4 session check and trusted-IP/account limits remain mandatory.
 */
export function createCircleOpenGateway({ backend, getStore, rateStorage, now = Date.now, legacyOnly = false } = {}) {
  if (typeof backend?.me !== 'function' || typeof getStore !== 'function' || !rateStorage) {
    throw new TypeError('Circle requires live V4 session, private Blob and limiter storage')
  }
  return Object.freeze({
    async handle(context) {
      const request = context?.request
      if (!request?.url) return response(404, 'not_found')
      const env = context?.env || {}
      const clientIp = typeof context.clientIp === 'string' ? context.clientIp.trim() : ''
      if (!clientIp || clientIp.length > 128) return response(503, 'circle_client_ip_unavailable')
      try {
        // Existing private store; v2 and v3 social keys remain isolated from V4.
        const store = getStore({ name: env.BLOB_STORE_NAME || 'qwerty-data', consistency: 'strong' })
        const scopedBlob = Object.freeze({
          async setJSON(key, event) {
            if (!KEY.test(key) || !SAFE_USER_ID.test(event?.actorUserId || '')) {
              throw new Error('Circle write key out of scope')
            }
            // A conservative account-deletion hold is recorded BEFORE the
            // social event; ambiguous writes may leave a harmless hold but
            // cannot knowingly acknowledge untracked social data.
            await store.setJSON('social/v2/accounts/' + event.actorUserId + '/used.json',
              { used: true })
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
        // One-use initial identity from this request's limiter only. Later checks
        // always hit the live backend; nothing survives a request or token change.
        let admission
        const authenticate = async token => {
          if (admission?.token === token) {
            const user = admission.user
            admission = undefined
            return user
          }
          return timeCircleStage('authenticate', () => backend.me(token))
        }
        const limiter = async ({ token }) => {
          const ipBudget = await timeCircleStage('limiter_ip', () => checkAuthRateLimit({
            storage: rateStorage, clientIp: 'circle-ip:' + clientIp,
            requestLimit: 60, windowSeconds: 60,
          }))
          if (!ipBudget.allowed) return false
          let user
          try { user = await timeCircleStage('authenticate', () => backend.me(token)) }
          catch (error) {
            if (error instanceof AppError && error.statusCode === 401) throw error
            throw new AppError(503, 'circle_session_unavailable', 'Circle session unavailable')
          }
          const userId = user?.user?.userId
          if (!SAFE_USER_ID.test(userId || '')) {
            throw new AppError(401, 'invalid_session', 'Valid session required')
          }
          const accountBudget = await timeCircleStage('limiter_account', () => checkAuthRateLimit({
            storage: rateStorage, clientIp: 'circle-account:' + userId,
            requestLimit: 60, windowSeconds: 60,
          }))
          if (accountBudget.allowed) admission = { token, user }
          return accountBudget.allowed
        }
        const assembly = createCircleEventualAssembly({
          backend, blobStore: scopedBlob, limit: limiter,
          maxEvents: 2000,
        })
        if (legacyOnly) return await assembly.transport.handle(request, { readBody: context.readBody })
        const service = createCircleBoundedService({
          storage: createCircleV3Storage(store), authenticate, now,
          legacy: assembly.service,
          hasLegacyCircle: async (id) => (await assembly.log.scan(id)).length > 0,
        })
        return await createCircleTransport({ service, rateLimit: limiter }).handle(request, { readBody: context.readBody })
      } catch {
        return response(503, 'circle_unavailable')
      }
    },
  })
}

/** Conservative hold: an account that ever wrote Circle data cannot
 * acknowledge deletion until an independent scrub is available.
 * The marker is written before each event, never inferred from a
 * potentially incomplete Circle event listing.
 */
export async function circleAccountHasActivity({ getStore, env = {}, userId } = {}) {
  if (typeof getStore !== 'function' || !SAFE_USER_ID.test(userId || '')) {
    throw new TypeError('Circle account activity check requires verified account')
  }
  const store = getStore({ name: env.BLOB_STORE_NAME || 'qwerty-data', consistency: 'strong' })
  const marker = await store.get('social/v2/accounts/' + userId + '/used.json',
    { type: 'json', consistency: 'strong' })
  return marker !== null
}
