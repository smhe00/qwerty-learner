/* eslint-env node */
import { AppError } from '../core.js'

/**
 * Production gate remains closed. No legacy v1/CAS route can be activated.
 * v2 transport.js is independently testable but NOT mounted in the gateway.
 * Gateway integration requires a separately qualified identity/limiter adapter.
 */
export function createCircleHttpHandler({ service, enabled = false } = {}) {
  if (enabled) throw new TypeError('Circle v2 HTTP release gate is closed')
  if (!service) throw new TypeError('Circle service is required')
  return Object.freeze({
    async handle() { throw new AppError(404, 'not_found', 'Not found') },
  })
}
