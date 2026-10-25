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
  // Owner-requested fixed bootstrap default. An explicit environment value
  // replaces it completely; malformed nonempty configuration fails closed.
  const effectivePassword = ADMIN_PASSWORD === '' || ADMIN_PASSWORD == null ? '98765432' : ADMIN_PASSWORD
  const matches = identity => isAdministrator(identity, ADMIN_USER_ID)
  const ready = () => typeof effectivePassword === 'string' && effectivePassword.length >= 4 && effectivePassword.length <= 128
  const signature = (token, identity) => crypto.createHmac('sha256', effectivePassword)
    .update(identity.userId + ':' + token).digest('base64url')
  return {
    matches,
    verify: password => ready() && typeof password === 'string' && equal(password, effectivePassword),
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
