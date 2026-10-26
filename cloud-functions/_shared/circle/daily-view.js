/* eslint-env node */
import { canonical, digest } from './event-log.js'
import { USER, calendarDay, fail, mapBounded, root } from './bounded-storage.js'

export function activityKey(record) {
  return root(record.circleId) + 'days/' + record.day + '/' + record.actorUserId + '/' + digest(record) + '.json'
}
export function validateActivity(record, key, circleId, day) {
  if (!record || record.schemaVersion !== 3 || record.circleId !== circleId || record.day !== day ||
      !calendarDay(day) || !USER.test(record.actorUserId || '') || activityKey(record) !== key) {
    fail(503, 'circle_activity_uncertain')
  }
  const p = record.payload
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(503, 'circle_activity_uncertain')
  const valid = record.type === 'progress'
    ? /^[A-Za-z0-9_-]{8,128}$/.test(p.eventId || '') && typeof p.completed === 'boolean' &&
      Number.isInteger(p.newWords) && p.newWords >= 0 && p.newWords <= 256
    : record.type === 'clap'
      ? USER.test(p.targetUserId || '') && p.targetUserId !== record.actorUserId
      : record.type === 'achievement' && /^ACH_[A-Z0-9_]{3,72}$/.test(p.achievementId || '')
  if (!valid) fail(503, 'circle_activity_uncertain')
  return record
}
const sort = (items) => items.sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'))

/** Independent immutable facts; conflicting payloads for one progress operation are omitted.
 * Cache construction is independent of membership. Authorization/filtering is always live.
 */
export function reduceDay(records, day) {
  const operations = new Map()
  const claps = new Map()
  const achievements = new Map()
  for (const r of records) {
    const p = r.payload
    if (r.type === 'progress') {
      const key = r.actorUserId + '/' + p.eventId
      const variants = operations.get(key) || new Map()
      variants.set(digest(p), r)
      operations.set(key, variants)
    } else if (r.type === 'clap') {
      claps.set(r.actorUserId + '/' + p.targetUserId,
        { actorUserId: r.actorUserId, authorUserId: p.targetUserId, day })
    } else {
      achievements.set(r.actorUserId + '/' + p.achievementId,
        { authorUserId: r.actorUserId, achievementId: p.achievementId, selfReported: true, verified: false })
    }
  }
  const progress = new Map()
  let ignoredActivityConflicts = 0
  for (const variants of operations.values()) {
    if (variants.size !== 1) { ignoredActivityConflicts++; continue }
    const r = variants.values().next().value
    const previous = progress.get(r.actorUserId)
    progress.set(r.actorUserId, { authorUserId: r.actorUserId, day,
      completed: Boolean(previous?.completed || r.payload.completed),
      newWords: Math.max(previous?.newWords || 0, r.payload.newWords), selfReported: true })
  }
  return { progress: sort([...progress.values()]), claps: sort([...claps.values()]),
    achievements: sort([...achievements.values()]), ignoredActivityConflicts }
}

export function createDailyViews(storage) {
  return Object.freeze({
    async read(circleId, day) {
      if (!calendarDay(day)) fail(400, 'invalid_day')
      const key = root(circleId) + 'summaries/' + day + '/view.json'
      const [keys, cached] = await Promise.all([storage.keys(root(circleId) + 'days/' + day + '/'), storage.get(key)])
      const fingerprint = digest(['circle-daily-v1', keys])
      if (cached !== null) {
        if (cached?.schemaVersion !== 3 || cached.circleId !== circleId || cached.day !== day ||
            !/^[a-f0-9]{64}$/.test(cached.sourceHash || '') || !Number.isInteger(cached.sourceCount) ||
            cached.contentHash !== digest(cached.data) ||
            !['progress', 'claps', 'achievements'].every((field) => Array.isArray(cached.data?.[field]))) {
          fail(503, 'circle_summary_uncertain')
        }
        if (cached.sourceHash === fingerprint && cached.sourceCount === keys.length) {
          return { ...cached.data, sourceHash: fingerprint, sourceCount: keys.length, snapshotOnly: true }
        }
      }
      const records = await mapBounded(keys, async (key) =>
        validateActivity(await storage.get(key), key, circleId, day))
      const data = reduceDay(records, day)
      // One replaceable summary per day. A late/stale writer may overwrite it,
      // but the next source-hash comparison detects that and rebuilds. No version buildup.
      // Empty days need no object. Later visibility changes the source hash.
      if (keys.length) await storage.put(key, { schemaVersion: 3, circleId, day,
        sourceHash: fingerprint, sourceCount: keys.length, contentHash: digest(data), data })
      return { ...data, sourceHash: fingerprint, sourceCount: keys.length, snapshotOnly: true }
    },
  })
}

export function filterDailyView(data, members) {
  const ids = new Set(members.map((m) => m.userId))
  const progress = data.progress.filter((p) => ids.has(p.authorUserId))
  const visibleProgress = new Set(progress.map((p) => p.authorUserId + '/' + p.day))
  return { ...data, progress,
    achievements: data.achievements.filter((a) => ids.has(a.authorUserId)),
    claps: data.claps.filter((c) => ids.has(c.actorUserId) && ids.has(c.authorUserId) &&
      visibleProgress.has(c.authorUserId + '/' + c.day)) }
}
