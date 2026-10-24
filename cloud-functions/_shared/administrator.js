/* eslint-env node */
import crypto from 'node:crypto'
import { isAdministrator } from './idle-accounts.js'

function equal(left, right) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(left).digest(),
    crypto.createHash('sha256').update(right).digest())
}

/** The environment password is never written to Blob, including as a verifier.
 * Signatures bind existing random session tokens to the current environment
 * password: rotating the variable invalidates old administrator sessions.
 */
export function administratorCredentials({ ADMIN_USER_ID = '', ADMIN_PASSWORD = '' } = {}) {
  const matches = identity => isAdministrator(identity, ADMIN_USER_ID)
  const ready = () => typeof ADMIN_PASSWORD === 'string' && ADMIN_PASSWORD.length >= 4 && ADMIN_PASSWORD.length <= 128
  const signature = (token, identity) => crypto.createHmac('sha256', ADMIN_PASSWORD)
    .update(identity.userId + ':' + token).digest('base64url')
  return {
    matches,
    verify: password => ready() && typeof password === 'string' && equal(password, ADMIN_PASSWORD),
    sign(token, identity) {
      if (!matches(identity)) return token
      if (!ready()) throw new Error('Administrator environment password is not configured')
      return token + '.' + signature(token, identity)
    },
    accepts(token, identity) {
      if (!matches(identity)) return token.split('.').length === 3
      if (!ready()) return false
      const parts = token.split('.')
      return parts.length === 4 && equal(parts[3], signature(parts.slice(0, 3).join('.'), identity))
    },
  }
}
