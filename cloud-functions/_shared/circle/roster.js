/* eslint-env node */
import { digest } from './event-log.js'
import { USER, fail, mapBounded, root } from './bounded-storage.js'
import { normalizeCircleNickname } from './nickname.js'

export const membership = (circleId, userId, nickname) => ({ schemaVersion: 3, circleId, userId,
  ...(nickname ? { nickname } : {}) })
export function validateMembership(value, circleId, userId) {
  if (value === null) return null
  if (value?.nickname !== undefined && (!value.nickname || normalizeCircleNickname(value.nickname) !== value.nickname)) fail(503, 'circle_control_uncertain')
  if (digest(value) !== digest(membership(circleId, userId, value?.nickname))) fail(503, 'circle_control_uncertain')
  return value
}
export function createCircleRoster(storage) {
  return async (circleId) => {
    const prefix = root(circleId) + 'members/'
    const cacheKey = root(circleId) + 'roster.json'
    const [entries, cached] = await Promise.all([storage.entries(prefix, { maxKeys: 500 }), storage.get(cacheKey)])
    const ids = entries.map(({key}) => key.slice(prefix.length, -5))
    if (ids.some(id => !USER.test(id))) fail(503, 'circle_membership_uncertain')
    // No ETag means no reuse: key-only fingerprints miss same-key nickname changes.
    const reusable = entries.every(entry => entry.etag)
    const sourceHash = digest(['circle-roster-v1', entries])
    if (reusable && cached?.sourceHash === sourceHash) {
      if (cached.schemaVersion !== 3 || cached.circleId !== circleId || !Array.isArray(cached.members) ||
          cached.members.length !== ids.length || cached.contentHash !== digest(cached.members) ||
          cached.members.some((m, i) => m.userId !== ids[i] || (m.nickname !== undefined && (!m.nickname || normalizeCircleNickname(m.nickname) !== m.nickname)))) fail(503, 'circle_roster_uncertain')
      return cached.members
    }
    const versions = await mapBounded(entries, async ({key}, i) => {
      const read = await storage.getVersioned(key)
      return {etag:read.etag, record:validateMembership(read.value, circleId, ids[i])}
    })
    const members = versions.map(v => v.record).filter(Boolean).map(({userId, nickname}) => ({userId, ...(nickname ? {nickname} : {})}))
    // A concurrent deletion is omitted; never cache an incomplete source set.
    if (reusable && members.length === entries.length && entries.length && versions.every((v,i) => v.etag && v.etag === entries[i].etag)) {
      await storage.put(cacheKey, {schemaVersion:3, circleId, sourceHash, members, contentHash:digest(members)})
    }
    return members
  }
}
