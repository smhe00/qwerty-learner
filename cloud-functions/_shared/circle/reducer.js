/* eslint-env node */
import { canonical, digest, validateEvent } from './event-log.js'
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0
const userId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const day = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v

/**
 * Pure visible-set reducer. Never an authorization oracle or final admission.
 * Logical operations with conflicting payloads are quarantined as a whole.
 * Permanent remove-wins membership and close-wins circle policy for this version.
 * No rejoin, invite rotation, mutable totals, wall-clock or arrival-order decisions.
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
  const events = []
  for (const [key, group] of groups) {
    const facts = new Set(group.map((e) => canonical(e.payload)))
    if (facts.size !== 1) { conflicts.push(key); continue }
    // Physical event IDs do not participate in semantic ordering or view hashes.
    const { eventId: _eventId, ...logical } = group[0]
    void _eventId
    events.push(logical)
  }
  events.sort((a, b) => cmp(a.dedupKey, b.dedupKey))
  conflicts.sort(cmp)
  const view = { schemaVersion: 2, circleId, consistency: 'eventual',
    admission: 'provisional', final: false, conflicts, meta: null, closed: false,
    members: [], pending: [], revoked: [], progress: [], achievements: [], claps: [] }
  const creates = events.filter((e) => e.type === 'CIRCLE_CREATED')
  // An ambiguous creation never selects an arbitrary owner.
  if (creates.length !== 1 || conflicts.length) {
    view.blocked = true
    view.viewHash = digest(view)
    return view
  }
  const created = creates[0]
  const p = created.payload
  if (typeof p.name !== 'string' || !p.name.trim() || Array.from(p.name).length > 32 ||
      !Number.isInteger(p.maxMembers) || p.maxMembers < 2 || p.maxMembers > 12 ||
      !/^[a-f0-9]{64}$/.test(p.inviteHash || '')) throw new Error('Invalid creation fact')
  view.meta = { ownerUserId: created.actorUserId, name: p.name, maxMembers: p.maxMembers }
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
  // Stable identity order is intentionally simple, not fairness or anti-Sybil.
  if (!view.closed) {
    const selected = [owner, ...candidates.slice(0, p.maxMembers - 1)]
    view.members = selected.map((uid) => ({ userId: uid,
      role: uid === owner ? 'owner' : 'member', status: 'provisional' }))
    view.pending = candidates.slice(p.maxMembers - 1)
    const member = new Set(selected)
    const progress = new Map()
    for (const e of events) {
      if (!member.has(e.actorUserId)) continue
      const d = e.payload
      if (e.type === 'PROGRESS_PUBLISHED') {
        if (!day(d.day) || typeof d.completed !== 'boolean' ||
            !Number.isInteger(d.newWords) || d.newWords < 0 || d.newWords > 256) {
          throw new Error('Invalid progress fact')
        }
        // Canonical logical-key winner for a daily report, never accumulated totals.
        progress.set(e.actorUserId + '/' + d.day, { authorUserId: e.actorUserId,
          day: d.day, completed: d.completed, newWords: d.newWords, selfReported: true })
      }
      if (e.type === 'ACHIEVEMENT_SHARED') {
        if (!/^ACH_[A-Z0-9_]{3,72}$/.test(d.achievementId || '') || d.verified !== true) {
          throw new Error('Invalid achievement fact')
        }
        view.achievements.push({ authorUserId: e.actorUserId, achievementId: d.achievementId })
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
  view.viewHash = digest(view)
  return view
}
