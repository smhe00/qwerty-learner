/* eslint-env node */
import { createCircleEventLog } from './event-log.js'
import { createCircleEventualService } from './service.js'
import { createCircleTransport } from './transport.js'

/**
 * Offline/injected composition for the agreed light-social consistency model.
 * Input blobStore must be a SERVER-PRIVATE EdgeOne Blob store, not a browser
 * credential or public object endpoint. All keys are scoped to social/v2/.
 *
 * backend.me(token) is the existing QWERTY Plus V4 authenticated session API;
 * it must reject invalid/expired/deleted sessions. A Circle-specific global
 * revocation authority is deliberately NOT required: leave/remove/close become
 * visible after Blob convergence, so responses are pending, never final.
 *
 * limit is a mandatory gateway-sourced IP/account limiter, not an in-memory
 * or Blob-CAS mutex. This factory is NOT mounted in the live gateway.
 */
export function createCircleEventualAssembly({
  backend, blobStore, inviteKey, limit, maxEvents = 10000,
} = {}) {
  if (typeof backend?.me !== 'function' ||
      !blobStore?.get || !blobStore?.setJSON || !blobStore?.list ||
      typeof limit !== 'function') {
    throw new TypeError('Circle requires V4 session, private Blob and gateway limiter')
  }
  const log = createCircleEventLog(blobStore, { maxEvents })
  const authenticate = (token) => backend.me(token)
  const service = createCircleEventualService({ log, authenticate, inviteKey })
  const transport = createCircleTransport({ service, rateLimit: limit })
  return Object.freeze({ log, service, transport })
}
