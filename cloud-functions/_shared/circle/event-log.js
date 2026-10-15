/* eslint-env node */
import crypto from 'node:crypto'

export const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item)
export const digest = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex')
const safe = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
const TYPES = new Set(['CIRCLE_CREATED', 'JOIN_REQUESTED', 'MEMBER_LEFT', 'MEMBER_REMOVED',
  'CIRCLE_CLOSED', 'REVOCATION_INTENDED', 'PROGRESS_PUBLISHED', 'ACHIEVEMENT_SHARED', 'CLAP_ADDED'])
export function logicalKey(event) {
  return digest([event.circleId, event.actorUserId, event.type, event.operationId])
}
export function validateEvent(event) {
  if (!event || event.schemaVersion !== 2 || !safe(event.eventId) || !safe(event.circleId) ||
      !safe(event.actorUserId) || !safe(event.operationId) || !TYPES.has(event.type) ||
      !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload) ||
      event.dedupKey !== logicalKey(event) || Buffer.byteLength(canonical(event)) > 8192) {
    throw new TypeError('Invalid Circle event envelope')
  }
  return event
}
export function makeEvent({ circleId, actorUserId, type, operationId, payload }) {
  const event = { schemaVersion: 2, eventId: crypto.randomBytes(16).toString('hex'),
    circleId, actorUserId, type, operationId, payload: structuredClone(payload) }
  event.dedupKey = logicalKey(event)
  return validateEvent(event)
}

/**
 * Server-only Blob log. Every append attempt uses a fresh random physical key.
 * No conditional writes, locks, shared indexes or authoritative view writes.
 * A lost response is UNKNOWN: retry the command with the SAME operationId.
 * Listing/get may omit committed objects; replay is only a visible-set snapshot.
 */
export function createCircleEventLog(blob, { maxEvents = 10000, readConcurrency = 8 } = {}) {
  if (!blob?.get || !blob?.setJSON || !blob?.list ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 ||
      !Number.isSafeInteger(readConcurrency) || readConcurrency < 1 || readConcurrency > 32) {
    throw new TypeError('Invalid event store')
  }
  const root = (id) => {
    if (!safe(id)) throw new TypeError('Invalid circle ID')
    return 'social/v2/circles/' + id + '/events/'
  }
  return Object.freeze({
    async append(command) {
      const event = makeEvent(command)
      try {
        await blob.setJSON(root(event.circleId) + event.eventId + '.json', event)
      } catch {
        const error = new Error('Circle append outcome unknown; retry the same operationId')
        error.code = 'circle_append_unknown'
        throw error
      }
      return { eventId: event.eventId, dedupKey: event.dedupKey, status: 'pending' }
    },
    // Destructive method is server-only and used exclusively behind the
    // independent retirement/maintenance guard. It never claims full erasure.
    async eraseEvent(circleId, eventId) {
      if (typeof eventId !== 'string' || !/^[a-f0-9]{32}$/.test(eventId) ||
          typeof blob.delete !== 'function') throw new TypeError('Invalid event deletion')
      await blob.delete(root(circleId) + eventId + '.json')
    },
    async scan(circleId) {
      const prefix = root(circleId)
      const result = await blob.list({ prefix })
      // Do not silently treat an unconsumed page as a complete scan.
      if (!Array.isArray(result?.blobs) || result.cursor || result.nextCursor ||
          result.hasMore || result.truncated) throw new Error('Incomplete Circle listing')
      const keys = [...new Set(result.blobs.map(({ key }) => key))]
      if (keys.length > maxEvents) throw new Error('Circle replay budget exceeded')
      // Reject out-of-scope listings before issuing any Blob GET.
      for (const key of keys) {
        if (typeof key !== 'string' || !key.startsWith(prefix) ||
            !/^[a-f0-9]{32}\.json$/.test(key.slice(prefix.length))) {
          throw new Error('Out-of-scope Circle event key')
        }
      }
      // Bounded read fanout: avoid N sequential remote GETs without assuming
      // linearizable listing, transactional snapshots, locks, or CAS.
      const events = new Array(keys.length)
      let next = 0
      let failure = null
      await Promise.all(Array.from({ length: Math.min(readConcurrency, keys.length) }, async () => {
        while (!failure && next < keys.length) {
          const index = next++
          const key = keys[index]
          try {
            const event = await blob.get(key, { type: 'json' })
            // A listed but unreadable object could be removal/closure. Never
            // omit it or return a partially authorized view.
            if (event === null) throw new Error('Circle listed event temporarily unreadable')
            validateEvent(event)
            if (event.circleId !== circleId || key !== prefix + event.eventId + '.json') {
              throw new Error('Circle event identity mismatch')
            }
            events[index] = event
          } catch (error) {
            failure ||= error
          }
        }
      }))
      if (failure) throw failure
      return events
    },
  })
}
