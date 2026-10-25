/* eslint-env node */
import crypto from 'node:crypto'
import { AppError } from './core.js'
import { withRetry } from './storage/edgeone-blob.js'
import { isAdministrator } from './idle-accounts.js'

const USER_ID = /^[a-f0-9]{32}$/
const SMHE_HASH = crypto.createHash('sha256').update('smhe').digest('hex')
const BINDING_KEY = 'maintenance/administrator/v1.json'

function equal(left, right) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(left).digest(),
    crypto.createHash('sha256').update(right).digest())
}

/** The environment password is never written to Blob, including as a verifier.
 * Signatures bind existing random session tokens to the current environment
 * password: rotating the variable invalidates old administrator sessions.
 */
export function administratorCredentials({ ADMIN_USER_ID = '', ADMIN_PASSWORD = '' } = {}, {
  resolveUserId = () => ADMIN_USER_ID, allowEnrollment = false, authorize,
} = {}) {
  // Owner-requested fixed bootstrap default. An explicit environment value
  // replaces it completely; malformed nonempty configuration fails closed.
  const effectivePassword = ADMIN_PASSWORD === '' || ADMIN_PASSWORD == null ? '98765432' : ADMIN_PASSWORD
  const managedName = name => name === 'smhe' && (allowEnrollment || USER_ID.test(resolveUserId() || ''))
  const matches = identity => isAdministrator(identity, resolveUserId()) ||
    (allowEnrollment && !resolveUserId() && USER_ID.test(identity?.userId || '') &&
      identity?.normalizedUsername === 'smhe' && identity?.status === 'active')
  const ready = () => typeof effectivePassword === 'string' && effectivePassword.length >= 4 && effectivePassword.length <= 128
  const signature = (token, identity) => crypto.createHmac('sha256', effectivePassword)
    .update(identity.userId + ':' + token).digest('base64url')
  return {
    matches,
    managedName,
    authorize,
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

/** Reserve SMHE logically without creating an account on site startup. First
 * successful env/default-password registration/login binds its real identity.
 * The binding contains identity metadata only, never a password/verifier.
 */
export async function loadAdministrator({ store, env = {} }) {
  const get = key => withRetry(() => store.get(key, { type: 'json', consistency: 'strong' }))
  const readBinding = async () => {
    const value = await get(BINDING_KEY)
    if (value !== null && (!USER_ID.test(value?.userId || '') || value.usernameHash !== SMHE_HASH)) {
      throw new AppError(503, 'administrator_binding_unavailable', 'Administrator identity binding is invalid')
    }
    return value
  }
  const saved = await readBinding()
  const configured = env.ADMIN_USER_ID || ''
  if ((configured && !USER_ID.test(configured)) || (saved && configured && configured !== saved.userId)) {
    throw new AppError(503, 'administrator_binding_mismatch', 'Administrator identity configuration does not match the binding')
  }
  let userId = saved?.userId || configured
  const credentials = administratorCredentials(env, {
    resolveUserId: () => userId,
    allowEnrollment: true,
    async authorize(identity) {
      if (!credentials.matches(identity) || identity.usernameHash !== SMHE_HASH) {
        throw new AppError(403, 'administrator_identity_mismatch', 'Administrator identity does not match')
      }
      const canonical = await get(`accounts/${SMHE_HASH}/identity.json`)
      if (canonical?.userId !== identity.userId || canonical.normalizedUsername !== 'smhe' || canonical.status !== 'active') {
        throw new AppError(409, 'administrator_identity_changed', 'Administrator registration has changed; sign in again')
      }
      const current = await readBinding()
      if (current && current.userId !== identity.userId) {
        throw new AppError(403, 'administrator_identity_mismatch', 'Administrator identity is already bound')
      }
      if (!current) {
        try {
          await store.setJSON(BINDING_KEY, { userId: identity.userId, usernameHash: SMHE_HASH }, { onlyIfNew: true })
        } catch { /* A lost write response is resolved by canonical read-back below. */ }
      }
      const confirmed = await readBinding()
      if (confirmed?.userId !== identity.userId) {
        throw new AppError(503, 'administrator_binding_unavailable', 'Administrator binding could not be confirmed')
      }
      if ((await get(`accounts/${SMHE_HASH}/identity.json`))?.userId !== identity.userId) {
        throw new AppError(409, 'administrator_identity_changed', 'Administrator registration changed before confirmation')
      }
      userId = confirmed.userId
    },
  })
  return { credentials, get userId() { return userId },
    isAdministrator: identity => isAdministrator(identity, userId) }
}
