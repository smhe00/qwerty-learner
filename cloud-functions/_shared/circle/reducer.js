/* eslint-env node */
import { canonical, digest, validateEvent } from './event-log.js'
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0
const userId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const day = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const ACTIVITY = new Set(['PROGRESS_PUBLISHED', 'ACHIEVEMENT_SHARED', 'CLAP_ADDED'])

/**
 * Light social visible-set reducer; never an authorization oracle.
 * Capacity is advisory; every valid visible join remains a member.
 * Activity conflicts are omitted without disabling unrelated encouragement.
 * Creation/membership/revocation conflicts still fail closed.
 */
export function reduceCircle(circleId, input) {
  const groups = new Map()
  const physical = new Map()
  for (const event of input) {
    validateEvent(event)
    if (event.circleId !== circleId) throw new Error('Mixed Circle event set')
    const prior = physical.get(event.eventId)
    if (prior && canonical(prior) !== canonical(event)) throw new Error('Physical event collision')
    physical.set(event.eventId, event)
    const group = groups.get(event.dedupKey) || []
    group.push(event)
    groups.set(event.dedupKey, group)
  }
  const conflicts = []
  const blockingConflicts = []
  const events = []
  for (const [key, group] of groups) {
    const facts = new Set(group.map((e) => canonical(e.payload)))
    if (facts.size !== 1) {
      conflicts.push(key)
      if (!ACTIVITY.has(group[0].type)) blockingConflicts.push(key)
      continue
    }
    const { eventId: _eventId, ...logical } = group[0]
    void _eventId
    events.push(logical)
  }
  events.sort((a, b) => cmp(a.dedupKey, b.dedupKey))
  conflicts.sort(cmp)
  blockingConflicts.sort(cmp)
  const view = { schemaVersion: 2, circleId, consistency: 'eventual',
    admission: 'eventual', final: false, conflicts, blockingConflicts,
    ignoredActivityConflicts: conflicts.length - blockingConflicts.length, ignoredInvalidActivities: 0,
    meta: null, closed: false, members: [], pending: [], revoked: [],
    progress: [], achievements: [], claps: [] }
  const creates = events.filter((e) => e.type === 'CIRCLE_CREATED')
  if (creates.length !== 1 || blockingConflicts.length) {
    view.blocked = true
    view.viewHash = digest(view)
    return view
  }
  const created = creates[0]
  const p = created.payload
  // Historical maxMembers is accepted only as an advisory hint.
  const softMemberLimit = p.softMemberLimit ?? p.maxMembers ?? 12
  if (typeof p.name !== 'string' || !p.name.trim() || Array.from(p.name).length > 32 ||
      !Number.isInteger(softMemberLimit) || softMemberLimit < 2 || softMemberLimit > 100 ||
      !/^[a-f0-9]{64}$/.test(p.inviteHash || '')) throw new Error('Invalid creation fact')
  view.meta = { ownerUserId: created.actorUserId, name: p.name, softMemberLimit }
  const owner = created.actorUserId
  view.closed = events.some((e) => e.type === 'CIRCLE_CLOSED' && e.actorUserId === owner)
  const revoked = new Set(events.filter((e) =>
    (e.type === 'MEMBER_LEFT' && e.actorUserId !== owner) ||
    (e.type === 'MEMBER_REMOVED' && e.actorUserId === owner &&
      userId(e.payload.targetUserId) && e.payload.targetUserId !== owner))
    .map((e) => e.type === 'MEMBER_LEFT' ? e.actorUserId : e.payload.targetUserId))
  view.revoked = [...revoked].sort(cmp)
  const candidates = [...new Set(events.filter((e) => e.type === 'JOIN_REQUESTED' &&
    e.payload.inviteHash === p.inviteHash && e.actorUserId !== owner &&
    !revoked.has(e.actorUserId)).map((e) => e.actorUserId))].sort(cmp)
  if (!view.closed) {
    const selected = [owner, ...candidates]
    view.members = selected.map((uid) => ({ userId: uid,
      role: uid === owner ? 'owner' : 'member', status: 'member' }))
    const member = new Set(selected)
    const progress = new Map()
    for (const e of events) {
      if (!member.has(e.actorUserId)) continue
      const d = e.payload
      if (e.type === 'PROGRESS_PUBLISHED') {
        if (!day(d.day) || typeof d.completed !== 'boolean' ||
            !Number.isInteger(d.newWords) || d.newWords < 0 || d.newWords > 256) {
          view.ignoredInvalidActivities++
          continue
        }
        const key = e.actorUserId + '/' + d.day
        const prior = progress.get(key)
        // Coarse encouragement: completed OR and highest daily self-report.
        // Never sum retries or pretend these are verified learning statistics.
        progress.set(key, { authorUserId: e.actorUserId, day: d.day,
          completed: Boolean(prior?.completed || d.completed),
          newWords: Math.max(prior?.newWords ?? 0, d.newWords), selfReported: true })
      }
      if (e.type === 'ACHIEVEMENT_SHARED') {
        if (typeof d.achievementId !== 'string' || !/^ACH_[A-Z0-9_]{3,72}$/.test(d.achievementId) ||
            (d.selfReported !== true && d.verified !== true)) {
          view.ignoredInvalidActivities++
          continue
        }
        // Historical verified shares remain readable as ordinary social shares;
        // the Circle feed never issues an official achievement or entitlement.
        view.achievements.push({ authorUserId: e.actorUserId, achievementId: d.achievementId,
          selfReported: true, verified: false })
      }
    }
    view.progress = [...progress.values()].sort((a, b) => cmp(canonical(a), canonical(b)))
    view.achievements = [...new Map(view.achievements.map((a) => [canonical(a), a])).values()]
      .sort((a, b) => cmp(canonical(a), canonical(b)))
    const claps = events.filter((e) => e.type === 'CLAP_ADDED' && member.has(e.actorUserId) &&
      member.has(e.payload.targetUserId) && e.actorUserId !== e.payload.targetUserId &&
      progress.has(e.payload.targetUserId + '/' + e.payload.day))
      .map((e) => ({ actorUserId: e.actorUserId, authorUserId: e.payload.targetUserId, day: e.payload.day }))
    view.claps = [...new Map(claps.map((a) => [canonical(a), a])).values()]
      .sort((a, b) => cmp(canonical(a), canonical(b)))
  }
  view.capacity = { softMemberLimit, memberCount: view.members.length,
    aboveSoftLimit: view.members.length > softMemberLimit, hardLimit: false }
  view.viewHash = digest(view)
  return view
}
