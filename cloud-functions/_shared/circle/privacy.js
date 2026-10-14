/* eslint-env node */
import { AppError } from '../core.js'
import { validateEvent } from './event-log.js'
const fail = (status, code) => { throw new AppError(status, code, code) }
const safe = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)

/** Schema-aware references; not a claim to detect personal names in free text. */
export function referencesAccount(event, userId) {
  validateEvent(event)
  return event.actorUserId === userId || event.payload.targetUserId === userId ||
    event.payload.command?.actorUserId === userId ||
    event.payload.command?.payload?.targetUserId === userId
}

/**
 * Server-only, explicitly invoked maintenance. No account/V4 endpoint is wired.
 * An independent irreversible retirement fence is required before deletion.
 * Eventual scans, deletion visibility and pre-fence writers prevent complete
 * erasure certification; keep retrying/auditing under the retirement fence.
 */
export function createCirclePrivacyMaintenance({ log, trustedAccess } = {}) {
  if (!log?.scan || !log?.eraseEvent || !trustedAccess) throw new TypeError('Privacy dependencies required')
  async function guard(circleId, userId, action, expectedFence) {
    if (!safe(circleId) || !safe(userId)) throw new TypeError('Invalid privacy maintenance scope')
    if (typeof trustedAccess.authorizeMaintenance !== 'function' ||
        await trustedAccess.authorizeMaintenance({ action, circleId, userId }) !== true) {
      fail(403, 'circle_maintenance_denied')
    }
    if (typeof trustedAccess.lookupRetirement !== 'function') fail(503, 'circle_retirement_unavailable')
    const retirement = await trustedAccess.lookupRetirement({ userId })
    if (!retirement || retirement.userId !== userId || retirement.status !== 'retired' ||
        !safe(retirement.fenceId) || (expectedFence && expectedFence !== retirement.fenceId)) {
      fail(503, 'circle_retirement_uncertain')
    }
    return retirement.fenceId
  }
  const summary = (events, userId) => {
    const matching = events.filter((e) => referencesAccount(e, userId))
    return { snapshotOnly: true, fullyErased: false, followUpRequired: true,
      observedEvents: events.length, residualObjects: matching.length }
  }
  return Object.freeze({
    async auditAccount(circleId, userId) {
      const action = 'audit_circle_retired_account'
      const fence = await guard(circleId, userId, action)
      const events = await log.scan(circleId)
      await guard(circleId, userId, action, fence)
      return summary(events, userId)
    },
    async scrubAccount(circleId, userId) {
      const action = 'scrub_circle_retired_account'
      const fence = await guard(circleId, userId, action)
      const events = await log.scan(circleId)
      let deleteAcknowledged = 0
      for (const e of events) {
        if (!referencesAccount(e, userId)) continue
        await guard(circleId, userId, action, fence)
        await log.eraseEvent(circleId, e.eventId)
        deleteAcknowledged++
      }
      // Acknowledged deletes may still be visible or have delayed writers.
      const remaining = await log.scan(circleId)
      await guard(circleId, userId, action, fence)
      return { ...summary(remaining, userId), deleteAcknowledged }
    },
  })
}
