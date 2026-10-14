/* eslint-env node */
import { AppError } from '../core.js'
import { canonical, digest, logicalKey, validateEvent } from './event-log.js'

const fail = (status, code) => { throw new AppError(status, code, code) }
const safe = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)

/** Only canonical permanent revocations are recoverable; no arbitrary commands. */
export function revocationCommand({ circleId, actorUserId, type, targetUserId }) {
  if (!safe(circleId) || !safe(actorUserId)) throw new TypeError('Invalid revocation identity')
  if (type === 'MEMBER_LEFT') {
    return { circleId, actorUserId, type, operationId: 'leave_circle', payload: {} }
  }
  if (type === 'CIRCLE_CLOSED') {
    return { circleId, actorUserId, type, operationId: 'close_circle', payload: {} }
  }
  if (type === 'MEMBER_REMOVED' && safe(targetUserId) && targetUserId !== actorUserId) {
    return { circleId, actorUserId, type, operationId: digest(['remove', targetUserId]),
      payload: { targetUserId } }
  }
  throw new TypeError('Invalid revocation command')
}
const keyFor = (command) => digest(['circle-revocation-v1', command])
function commandFromIntent(event) {
  validateEvent(event)
  const c = event.payload.command
  if (!c || c.circleId !== event.circleId || c.actorUserId !== event.actorUserId) {
    throw new TypeError('Invalid revocation intent scope')
  }
  const expected = revocationCommand({ ...c, targetUserId: c.payload?.targetUserId })
  if (canonical(c) !== canonical(expected) || event.operationId !== keyFor(expected) ||
      canonical(event.payload) !== canonical({ command: expected })) {
    throw new TypeError('Noncanonical revocation intent')
  }
  return expected
}

/**
 * Immutable Blob intents are a replayable outbox, NOT an authority.
 * Reliable independent authority MUST commit an idempotent access fence and
 * retain an exact bound receipt; lookup must never infer it from Blob.
 * No ack marker, lock, CAS, shared cursor or shared-state RMW is used.
 */
export function createCircleRevocationCoordinator({ log, trustedAccess } = {}) {
  if (!log?.append || !log?.scan || !trustedAccess) throw new TypeError('Revocation dependencies required')
  async function receipt(command) {
    if (typeof trustedAccess.lookupRevocation !== 'function') {
      fail(503, 'circle_revocation_receipt_unavailable')
    }
    const operationId = keyFor(command)
    let actual
    try { actual = await trustedAccess.lookupRevocation({ operationId, commandHash: digest(command) }) }
    catch { fail(503, 'circle_revocation_receipt_unavailable') }
    if (actual === null) return false // reliable authority says not committed
    if (!actual || actual.status !== 'committed' || actual.operationId !== operationId ||
        actual.commandHash !== digest(command)) fail(503, 'circle_revocation_receipt_invalid')
    return true
  }
  async function maintain(circleId, command) {
    if (typeof trustedAccess.authorizeMaintenance !== 'function' ||
        await trustedAccess.authorizeMaintenance({ action: 'recover_circle_revocations', circleId,
          commandHash: command ? digest(command) : undefined,
          subjects: command ? [command.actorUserId, command.payload.targetUserId].filter(Boolean) : undefined }) !== true) {
      fail(403, 'circle_maintenance_denied')
    }
  }
  return Object.freeze({
    async execute({ token, proof, command }) {
      command = revocationCommand({ ...command, targetUserId: command.payload?.targetUserId })
      if (proof.circleId !== command.circleId ||
          typeof trustedAccess.revoke !== 'function' ||
          typeof trustedAccess.lookupRevocation !== 'function') {
        fail(503, 'circle_revocation_unavailable')
      }
      // Acknowledged intent must precede fence commit. Unknown intent response:
      // DO NOT fence; retry the same command through normal authentication.
      await log.append({ circleId: command.circleId, actorUserId: command.actorUserId,
        type: 'REVOCATION_INTENDED', operationId: keyFor(command), payload: { command } })
      const kind = command.type === 'CIRCLE_CLOSED' ? 'circle' : 'member'
      const targetUserId = command.type === 'MEMBER_LEFT' ? command.actorUserId : command.payload.targetUserId
      let committed
      try {
        committed = await trustedAccess.revoke({ ...proof, token,
          actorUserId: command.actorUserId, kind, targetUserId, command,
          operationId: keyFor(command), commandHash: digest(command) })
      } catch { fail(503, 'circle_revocation_unknown') }
      if (committed !== true || !await receipt(command)) fail(503, 'circle_revocation_unavailable')
      // Actor may already be fenced. A durable receipt authorizes only this
      // exact monotonic event, never private reads or a different operation.
      return log.append(command)
    },
    async recover(circleId) {
      if (!safe(circleId)) throw new TypeError('Invalid recovery Circle ID')
      await maintain(circleId)
      const events = await log.scan(circleId)
      const groups = new Map()
      for (const e of events.filter((e) => e.type === 'REVOCATION_INTENDED')) {
        const group = groups.get(e.dedupKey) || []
        group.push(e)
        groups.set(e.dedupKey, group)
      }
      const result = { snapshotOnly: true, fullyRecovered: false,
        observed: groups.size, appended: 0, alreadyVisible: 0, deferred: 0, blocked: 0 }
      for (const group of groups.values()) {
        if (new Set(group.map((e) => canonical(e.payload))).size !== 1) { result.blocked++; continue }
        let command
        try { command = commandFromIntent(group[0]) } catch { result.blocked++; continue }
        // No assumed commit from an intent, a missing final event or a stale view.
        if (!await receipt(command)) { result.deferred++; continue }
        const observed = events.filter((e) => e.dedupKey === logicalKey(command))
        if (observed.some((e) => canonical(e.payload) !== canonical(command.payload))) {
          result.blocked++; continue
        }
        if (observed.length) { result.alreadyVisible++; continue }
        await maintain(circleId, command) // also gate retired subjects before replay
        await log.append(command) // new physical key, same logical operation
        result.appended++
      }
      await maintain(circleId)
      return result // counts only; NEVER a certification of complete listing
    },
  })
}
