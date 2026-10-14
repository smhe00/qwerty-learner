/* eslint-env node */
import { AppError } from '../core.js'

const fail = (status, code) => { throw new AppError(status, code, code) }
const safe = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const functionNames = ['check', 'commitRevocation', 'lookupRevocation',
  'authorizeMaintenance', 'lookupRetirement']

/**
 * Server-only bridge for an EXISTING V4 session and an INDEPENDENT, reliable
 * Circle authority. This deliberately DOES NOT create that authority.
 *
 * backend.me(token) establishes current account/session identity ONLY; it is
 * not a durable privacy fence or a strong-consistency source.
 *
 * authority.check MUST synchronously evaluate fresh policy, retirement,
 * circle/subject fences and session-version binding at its own consistency
 * point. authority.commitRevocation MUST atomically fence access and commit
 * an exact durable receipt; lookupRevocation must read that committed state.
 * Missing, stale, unknown or failing authority decisions MUST fail closed.
 * Never implement authority on a Blob/KV read-modify-write "lock".
 */
export function createCircleTrustedAccessAdapter({
  backend, authority, nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof backend?.me !== 'function' ||
      functionNames.some((name) => typeof authority?.[name] !== 'function') ||
      typeof nowSeconds !== 'function') {
    throw new TypeError('Current-session backend and independent Circle authority required')
  }

  async function authenticate(token) {
    if (typeof token !== 'string' || !token || token.length > 2048) {
      fail(401, 'invalid_token')
    }
    let session
    try {
      session = await backend.me(token)
    } catch (error) {
      // Preserve typed revoked/expired session outcomes from the existing V4
      // backend; do not surface raw storage errors or token contents.
      if (error instanceof AppError && error.statusCode === 401) throw error
      fail(503, 'circle_session_unavailable')
    }
    const identity = session?.user?.userId
    const version = session?.session?.version
    const expiresAt = session?.session?.expiresAt
    const now = nowSeconds()
    if (!safe(identity) || !Number.isSafeInteger(version) || version < 1 ||
        !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)) {
      fail(503, 'circle_session_uncertain')
    }
    if (expiresAt <= now) fail(401, 'session_expired')
    return Object.freeze({ userId: identity, sessionVersion: version, expiresAt })
  }

  // A guard is authorization for exactly this action/view/subject set, not a
  // transferable permit. Never pass the bearer token into the policy provider.
  async function check({ token, actorUserId, circleId, action, phase, subjects,
    viewHash } = {}) {
    if (!safe(actorUserId) || !safe(circleId) || !safe(action) || !safe(phase) ||
        !Array.isArray(subjects) || subjects.some((subject) => !safe(subject)) ||
        subjects.length > 10000 ||
        (viewHash !== undefined && !hash(viewHash))) return false
    try {
      const session = await authenticate(token)
      if (session.userId !== actorUserId) return false
      return (await authority.check({
        actorUserId, sessionVersion: session.sessionVersion,
        sessionExpiresAt: session.expiresAt, circleId, action, phase,
        subjects: [...new Set(subjects)].sort(), viewHash,
      })) === true
    } catch { return false }
  }

  async function revoke({ token, actorUserId, circleId, command,
    operationId, commandHash, kind, targetUserId, ...proof } = {}) {
    if (!safe(actorUserId) || !safe(circleId) || !hash(operationId) ||
        !hash(commandHash) || !command || command.circleId !== circleId ||
        command.actorUserId !== actorUserId ||
        !['circle', 'member'].includes(kind) ||
        (kind === 'member' && !safe(targetUserId))) return false
    try {
      const session = await authenticate(token)
      if (session.userId !== actorUserId) return false
      const receipt = await authority.commitRevocation({
        actorUserId, sessionVersion: session.sessionVersion,
        sessionExpiresAt: session.expiresAt,
        circleId, command, operationId, commandHash, kind,
        targetUserId, proof: { action: proof.action, viewHash: proof.viewHash,
          subjects: proof.subjects },
      })
      // A boolean "accepted" or eventual log ack is NOT a durable fence.
      return receipt?.status === 'committed' &&
        receipt.operationId === operationId && receipt.commandHash === commandHash
    } catch { return false }
  }

  async function lookupRevocation({ operationId, commandHash } = {}) {
    if (!hash(operationId) || !hash(commandHash)) fail(503, 'circle_revocation_receipt_invalid')
    let receipt
    try { receipt = await authority.lookupRevocation({ operationId, commandHash }) }
    catch { fail(503, 'circle_revocation_receipt_unavailable') }
    if (receipt === null) return null // confirmed absent, NOT an outage
    if (receipt?.status !== 'committed' || receipt.operationId !== operationId ||
        receipt.commandHash !== commandHash) fail(503, 'circle_revocation_receipt_invalid')
    return Object.freeze({ status: 'committed', operationId, commandHash })
  }

  async function authorizeMaintenance(scope = {}) {
    if (!safe(scope.circleId) || !safe(scope.action) ||
        (scope.userId !== undefined && !safe(scope.userId)) ||
        (scope.subjects !== undefined &&
          (!Array.isArray(scope.subjects) || scope.subjects.some((s) => !safe(s))))) return false
    try { return (await authority.authorizeMaintenance(scope)) === true }
    catch { return false }
  }

  async function lookupRetirement({ userId } = {}) {
    if (!safe(userId)) fail(503, 'circle_retirement_uncertain')
    let result
    try { result = await authority.lookupRetirement({ userId }) }
    catch { fail(503, 'circle_retirement_unavailable') }
    if (result === null) return null
    if (result?.userId !== userId || result.status !== 'retired' ||
        !safe(result.fenceId)) fail(503, 'circle_retirement_uncertain')
    return Object.freeze({ userId, status: 'retired', fenceId: result.fenceId })
  }

  return Object.freeze({ authenticate, trustedAccess: Object.freeze({
    check, revoke, lookupRevocation, authorizeMaintenance, lookupRetirement,
  }) })
}
