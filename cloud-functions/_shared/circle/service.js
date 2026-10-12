/* eslint-env node */
import crypto from 'node:crypto'
import { AppError } from '../core.js'

const ID = /^[A-Za-z0-9_-]{4,128}$/
const CIRCLE_ID = /^[A-Za-z0-9_-]{12}$/
const EVENT_ID = /^[A-Za-z0-9_-]{8,80}$/
const ACHIEVEMENT_ID = /^ACH_[A-Z0-9_]{3,72}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_INVITE_ROTATIONS = 8 // Each rotation is immutable and CAS-gated.
const MAX_PEERS = 11 // Owner + 11 peers. Each immutable slot has one winner.
const PROGRESS_SLOTS = 4 // Four daily updates per member, no unbounded append.
const fail = (status, code, message) => { throw new AppError(status, code, message) }
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()
const randomId = () => crypto.randomBytes(9).toString('base64url')
const metaKey = (id) => `circles/${id}/meta.json`
const inviteKey = (id, rev) => `circles/${id}/invites/${String(rev).padStart(2, '0')}.json`
const closedKey = (id) => `circles/${id}/closed.json`
const slotKey = (id, slot) => `circles/${id}/seats/${String(slot).padStart(2, '0')}.json`
const disabledKey = (uid) => `accounts-disabled/${uid}.json`
const userCircleKey = (uid, id) => `user-circles/${uid}/${id}.json`
const revokedKey = (id, uid) => `circles/${id}/revoked/${uid}.json`
const progressKey = (id, uid, day, slot) =>
  `circles/${id}/progress/${uid}/${day}/${String(slot).padStart(2, '0')}.json`
const reactionKey = (id, actor, author, day) =>
  `circles/${id}/reactions/${actor}/${author}/${day}.json`
const achievementKey = (id, uid, achievementId) =>
  `circles/${id}/showcase/${uid}/${achievementId}.json`

function validId(id) {
  if (typeof id !== 'string' || !ID.test(id)) fail(400, 'invalid_user', 'Invalid immutable user ID')
  return id
}
function validCircleId(id) {
  if (typeof id !== 'string' || !CIRCLE_ID.test(id)) fail(400, 'invalid_circle', 'Invalid circle ID')
  return id
}
function validDay(day) {
  if (typeof day !== 'string' || !DAY.test(day) ||
      !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) {
    fail(400, 'invalid_day', 'Invalid calendar day')
  }
  return day
}
function eligibleDay(day) {
  const offsetDays = Math.abs(Date.parse(validDay(day) + 'T00:00:00Z') -
    Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000
  if (offsetDays > 1) fail(400, 'day_out_of_range', 'Only near-current daily progress can be published')
  return day
}
function parseInvite(input) {
  if (typeof input !== 'string') fail(404, 'invalid_invite', 'Invalid Circle invite')
  const match = /^QC-([A-Za-z0-9_-]{12})-([A-Za-z0-9_-]{12})$/.exec(input.trim())
  if (!match) fail(404, 'invalid_invite', 'Invalid Circle invite')
  return { id: match[1], secret: match[2] }
}
function inviteMatches(secret, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest || '')) return false
  return crypto.timingSafeEqual(Buffer.from(hash(secret), 'hex'), Buffer.from(digest, 'hex'))
}
function ensureName(input) {
  if (typeof input !== 'string') fail(400, 'invalid_name', 'Circle name required')
  const name = input.trim().normalize('NFKC')
  if (!name || Array.from(name).length > 32 || [...name].some((ch) => { const n = ch.charCodeAt(0); return n < 32 || n === 127 })) {
    fail(400, 'invalid_name', 'Circle name must be 1-32 visible characters')
  }
  return name
}
function validateReport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(400, 'invalid_progress', 'Progress body must be an object')
  }
  if (typeof data.completed !== 'boolean' ||
      !Number.isSafeInteger(data.newWords) || data.newWords < 0 || data.newWords > 256) {
    fail(400, 'invalid_progress', 'Invalid completed/newWords progress fields')
  }
  if (typeof data.eventId !== 'string' || !EVENT_ID.test(data.eventId)) {
    fail(400, 'invalid_event', 'An 8-80 character idempotency ID is required')
  }
  return { completed: data.completed, newWords: data.newWords, eventId: data.eventId }
}

/**
 * Transport-free Circle kernel. authenticate(token) MUST resolve the actual,
 * currently valid account session server-side. Never accept userId in commands.
 * verifyAchievement(userId,id) MUST check authoritative evidence when enabled.
 *
 * Constraints: no rejoin after permanent revocation, no seat recycling, no
 * editable invitations, no account deletion until cascade/projection is built.
 * Keep endpoints CLOSED until those lifecycle gates have passed.
 */
export function createCircleService({ storage, authenticate, verifyAchievement } = {}) {
  if (!storage?.read || !storage?.create || typeof authenticate !== 'function') {
    throw new TypeError('Circle needs immutable Blob storage and server authentication')
  }
  async function actor(token) {
    const auth = await authenticate(token)
    const uid = validId(auth?.user?.userId ?? auth?.userId)
    if (await storage.read(disabledKey(uid))) {
      fail(403, 'circle_account_disabled', 'Circle access is disabled for this account')
    }
    return uid
  }
  async function circle(id) {
    id = validCircleId(id)
    const meta = await storage.read(metaKey(id))
    if (!meta || meta.schemaVersion !== 1) fail(404, 'circle_not_found', 'Circle not found')
    if (await storage.read(closedKey(id)) ||
        await storage.read(disabledKey(meta.ownerUserId))) {
      fail(410, 'circle_closed', 'Circle has closed')
    }
    return meta
  }
  async function latestInvite(meta) {
    // The first missing revision is terminal under create-only rotation.
    // No revision may be skipped by a legitimate rotation.
    let last = { revision: 0, inviteHash: meta.inviteHash }
    for (let rev = 1; rev <= MAX_INVITE_ROTATIONS; rev++) {
      const record = await storage.read(inviteKey(meta.circleId, rev))
      if (!record) break
      last = { revision: rev, inviteHash: record.inviteHash }
    }
    return last
  }
  async function peers(id) {
    return (await Promise.all(Array.from({ length: MAX_PEERS }, (_, i) =>
      storage.read(slotKey(id, i + 1))))).filter(Boolean)
  }
  async function members(meta) {
    const enrolled = [{ userId: meta.ownerUserId, role: 'owner' },
      ...(await peers(meta.circleId)).map((p) => ({ userId: p.userId, role: 'member' }))]
    const inactive = await Promise.all(enrolled.map(async (m) =>
      (await storage.read(revokedKey(meta.circleId, m.userId))) ||
      (await storage.read(disabledKey(m.userId)))))
    return enrolled.filter((_m, i) => !inactive[i])
  }
  async function membership(meta, uid) {
    const current = await members(meta)
    if (!current.some((m) => m.userId === uid)) {
      fail(403, 'not_circle_member', 'Not a current member of this circle')
    }
    return current
  }
  async function requireOwner(meta, uid) {
    if (uid !== meta.ownerUserId) fail(403, 'not_circle_owner', 'Circle owner required')
    await membership(meta, uid)
  }
  async function createCircle(token, { name } = {}) {
    const uid = await actor(token)
    const cleanName = ensureName(name)
    // One authoritative immutable meta object: avoids cross-object invite
    // index transactions. The code embeds opaque circle ID + secret.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomId()
      const secret = randomId()
      const meta = {
        schemaVersion: 1, circleId: id, name: cleanName,
        ownerUserId: uid, inviteHash: hash(secret),
        createdAt: now(), maxMembers: MAX_PEERS + 1,
      }
      // A reverse index is durably committed before membership is made
      // visible; a failed create can leave a harmless dangling index.
      await storage.create(userCircleKey(uid, id), { circleId: id, userId: uid })
      if (await storage.create(metaKey(id), meta)) {
        return { circleId: id, name: cleanName, inviteCode: `QC-${id}-${secret}` }
      }
    }
    fail(503, 'circle_id_exhausted', 'Unable to allocate a Circle')
  }
  async function joinCircle(token, inviteCode) {
    const uid = await actor(token)
    const { id, secret } = parseInvite(inviteCode)
    let meta
    try { meta = await circle(id) } catch {
      fail(404, 'invalid_invite', 'Invalid Circle invite')
    }
    const validInvite = await latestInvite(meta)
    if (!inviteMatches(secret, validInvite.inviteHash)) {
      fail(404, 'invalid_invite', 'Invalid Circle invite')
    }
    if (await storage.read(revokedKey(id, uid))) {
      fail(403, 'membership_revoked', 'Membership was revoked; rejoin is disabled in V1')
    }
    if (uid === meta.ownerUserId) return { circleId: id, role: 'owner' }
    // All callers examine seats in ONE canonical ascending order and use
    // atomic create-only CAS at each slot. A losing contender MUST reread
    // the winning seat and return when the winner has the same userId.
    // This prevents duplicate seats without an abandoned cross-object claim.
    //
    // A crash before a seat write leaves nothing reserved. A lost response
    // after a durable write is recovered through read-back.
    //
    // The reverse user->circle index is committed before any seat, so a
    // trusted account retirement can enumerate all possible memberships.
    await storage.create(userCircleKey(uid, id), { circleId: id, userId: uid })
    for (let seat = 1; seat <= MAX_PEERS; seat++) {
      const key = slotKey(id, seat)
      const existing = await storage.read(key)
      if (existing?.userId === uid) {
        await actor(token)
        await circle(id)
        if (await storage.read(revokedKey(id, uid))) {
          fail(403, 'membership_revoked', 'Membership was revoked')
        }
        return { circleId: id, role: 'member' }
      }
      if (existing) continue
      const candidate = { userId: uid, joinedAt: now() }
      const won = await storage.create(key, candidate)
      if (!won) {
        // Another request may have won this exact seat. Do not advance to
        // the next seat before checking whether it is our own account.
        const winner = await storage.read(key)
        if (winner?.userId !== uid) continue
      }
      await actor(token)
      await circle(id)
      if (await storage.read(revokedKey(id, uid))) {
        fail(403, 'membership_revoked', 'Membership was revoked')
      }
      return { circleId: id, role: 'member' }
    }
    fail(409, 'circle_full', 'Circle has reached its 12-person lifetime seat limit')
  }
  async function rotateInvite(token, id) {
    const uid = await actor(token)
    const meta = await circle(id)
    await requireOwner(meta, uid)
    const current = await latestInvite(meta)
    if (current.revision >= MAX_INVITE_ROTATIONS) {
      fail(409, 'invite_rotation_exhausted', 'Invite rotation limit reached')
    }
    const secret = randomId()
    const record = { revision: current.revision + 1, inviteHash: hash(secret),
      changedBy: uid, changedAt: now() }
    if (!(await storage.create(inviteKey(id, record.revision), record))) {
      // A concurrent rotation won this version. Do not silently publish a
      // second different secret or disclose the other request's secret.
      fail(409, 'invite_rotation_conflict', 'Invite was rotated concurrently')
    }
    await circle(id)
    return { circleId: id, revision: record.revision,
      inviteCode: `QC-${id}-${secret}` }
  }
  async function getCircle(token, id) {
    const uid = await actor(token)
    const meta = await circle(id)
    const current = await membership(meta, uid)
    return {
      circleId: meta.circleId, name: meta.name, maxMembers: meta.maxMembers,
      ownerUserId: meta.ownerUserId, members: current,
    }
  }
  async function revoke(token, id, targetId, remove) {
    const uid = await actor(token)
    const meta = await circle(id)
    targetId = validId(targetId)
    if (remove) await requireOwner(meta, uid)
    else if (uid !== targetId) fail(403, 'not_self', 'Only self can leave')
    if (targetId === meta.ownerUserId) fail(409, 'owner_cannot_leave', 'Owner must close the Circle')
    const current = await members(meta)
    if (!current.some((m) => m.userId === targetId)) {
      if (await storage.read(revokedKey(id, targetId))) return { revoked: true }
      fail(404, 'member_not_found', 'Member not found')
    }
    await storage.create(revokedKey(id, targetId), {
      userId: targetId, revokedBy: uid, revokedAt: now(), reason: remove ? 'removed' : 'left',
    })
    return { revoked: true }
  }
  async function leave(token, id) {
    const uid = await actor(token)
    return revoke(token, id, uid, false)
  }
  async function removeMember(token, id, targetId) {
    return revoke(token, id, targetId, true)
  }
  async function closeCircle(token, id) {
    const uid = await actor(token)
    const meta = await circle(id)
    await requireOwner(meta, uid)
    await storage.create(closedKey(id), { closedAt: now(), closedBy: uid })
    return { closed: true }
  }
  async function publishProgress(token, id, day, input) {
    const uid = await actor(token)
    const meta = await circle(id)
    await membership(meta, uid)
    day = eligibleDay(day)
    const data = validateReport(input)
    // Exactly one canonical slot order shared by all callers. A lost or
    // interrupted request may be retried safely: no permanent claim is
    // created before the actual event record. A duplicate winner is checked
    // at each slot after atomic create-only conflict.
    const reportKeys = Array.from({ length: PROGRESS_SLOTS }, (_v, i) =>
      progressKey(id, uid, day, i))
    for (let slot = 0; slot < PROGRESS_SLOTS; slot++) {
      const key = reportKeys[slot]
      const prior = await storage.read(key)
      if (prior?.eventId === data.eventId) {
        if (prior.completed !== data.completed || prior.newWords !== data.newWords) {
          fail(409, 'idempotency_conflict', 'Event ID was used with different progress')
        }
        return prior
      }
      if (prior) continue
      const report = {
        authorUserId: uid, day, eventId: data.eventId,
        completed: data.completed, newWords: data.newWords,
        createdAt: now(), selfReported: true,
      }
      const won = await storage.create(key, report)
      const winner = won ? report : await storage.read(key)
      if (winner?.eventId === data.eventId) {
        if (winner.completed !== data.completed || winner.newWords !== data.newWords) {
          fail(409, 'idempotency_conflict', 'Event ID was used with different progress')
        }
        await actor(token)
        await circle(id)
        if (await storage.read(revokedKey(id, uid))) {
          fail(403, 'membership_revoked', 'Membership was revoked')
        }
        return winner
      }
    }
    fail(429, 'daily_progress_limit', 'Daily Circle progress update limit reached')
  }
  async function memberReport(id, uid, day) {
    const reports = await Promise.all(Array.from({ length: PROGRESS_SLOTS }, (_, slot) =>
      storage.read(progressKey(id, uid, day, slot))))
    return reports.filter(Boolean).at(-1) ?? null
  }
  async function getProgress(token, id, day) {
    const uid = await actor(token)
    const meta = await circle(id)
    const current = await membership(meta, uid)
    day = validDay(day)
    const reports = await Promise.all(current.map((m) => memberReport(id, m.userId, day)))
    // Prevent a revoke race from returning newly private data.
    await actor(token)
    await circle(id)
    await membership(meta, uid)
    const stillActive = await members(meta)
    return reports.filter((report) =>
      report && stillActive.some((m) => m.userId === report.authorUserId))
  }
  async function reactProgress(token, id, targetId, day) {
    const uid = await actor(token)
    const meta = await circle(id)
    const current = await membership(meta, uid)
    targetId = validId(targetId)
    day = validDay(day)
    if (!current.some((m) => m.userId === targetId) ||
        !(await memberReport(id, targetId, day))) {
      fail(404, 'progress_not_found', 'No visible progress for this member and day')
    }
    const reaction = {
      authorUserId: uid, targetUserId: targetId, day,
      kind: 'clap', createdAt: now(),
    }
    const key = reactionKey(id, uid, targetId, day)
    const existing = await storage.read(key)
    if (existing) return existing
    if (await storage.create(key, reaction)) return reaction
    return storage.read(key)
  }
  async function getReactions(token, id, targetId, day) {
    const uid = await actor(token)
    const meta = await circle(id)
    const current = await membership(meta, uid)
    targetId = validId(targetId)
    day = validDay(day)
    if (!current.some((m) => m.userId === targetId)) fail(404, 'member_not_found', 'Member not found')
    const reactions = await Promise.all(current.map((m) =>
      storage.read(reactionKey(id, m.userId, targetId, day))))
    await actor(token)
    await circle(id)
    await membership(meta, uid)
    return { count: reactions.filter(Boolean).length }
  }
  async function shareAchievement(token, id, achievementId) {
    const uid = await actor(token)
    const meta = await circle(id)
    await membership(meta, uid)
    if (typeof achievementId !== 'string' || !ACHIEVEMENT_ID.test(achievementId)) {
      fail(400, 'invalid_achievement', 'Invalid achievement ID')
    }
    if (!verifyAchievement || !(await verifyAchievement(uid, achievementId))) {
      fail(403, 'unverified_achievement', 'Server verification of achievement required')
    }
    const key = achievementKey(id, uid, achievementId)
    const existing = await storage.read(key)
    if (existing) return existing
    const shared = { authorUserId: uid, achievementId, sharedAt: now(), verified: true }
    if (await storage.create(key, shared)) return shared
    return storage.read(key)
  }
  async function getShowcase(token, id, targetId, ids = []) {
    const uid = await actor(token)
    const meta = await circle(id)
    const current = await membership(meta, uid)
    targetId = validId(targetId)
    if (!current.some((m) => m.userId === targetId)) fail(404, 'member_not_found', 'Member not found')
    if (!Array.isArray(ids) || ids.length > 20 ||
        ids.some((value) => typeof value !== 'string' || !ACHIEVEMENT_ID.test(value))) {
      fail(400, 'invalid_achievements', 'Provide up to 20 achievement IDs')
    }
    const entries = await Promise.all(ids.map((achievementId) =>
      storage.read(achievementKey(id, targetId, achievementId))))
    await actor(token)
    await circle(id)
    await membership(meta, uid)
    return entries.filter(Boolean)
  }
  /**
   * Call ONLY from trusted account lifecycle code, never from a public
   * arbitrary-user endpoint. The durable fence prevents later Circle reads
   * or writes; physical privacy erasure is a separate, required rollout gate.
   */
  async function quarantineAccount(userId) {
    const uid = validId(userId)
    await storage.create(disabledKey(uid), { userId: uid, disabledAt: now() })
    // No reverse index may be missing for a committed membership because it
    // is always created BEFORE the meta/seat record.
    const references = await storage.list(`user-circles/${uid}/`)
    return { disabled: true, circleCount: references.length }
  }

  /**
   * Trusted, retryable activity scrub AFTER durable quarantine. Removes
   * user-authored progress, shared achievements and clap records (including
   * claps from other participants addressed to this user). Does NOT remove
   * capacity seats, ownership metadata, reverse indexes or tombstones:
   * those require a separate transactional identity-erasure protocol.
   *
   * No HTTP route calls this method. The returned "fullyErased" field is
   * always false because Blob cannot fence already in-flight old writers.
   */
  async function scrubAccountActivities(userId) {
    const uid = validId(userId)
    if (typeof storage.list !== 'function' || typeof storage.remove !== 'function') {
      throw new TypeError('Account scrub requires strong Blob list and delete')
    }
    await quarantineAccount(uid)
    const userRefs = await storage.list(`user-circles/${uid}/`)
    let deleted = 0
    let circlesAffected = 0
    const idPattern = /^user-circles\/[A-Za-z0-9_-]{4,128}\/([A-Za-z0-9_-]{12})\.json$/
    for (const ref of userRefs) {
      const match = idPattern.exec(ref)
      if (!match) throw new Error('Malformed Circle membership reverse index')
      const id = match[1]
      const meta = await storage.read(metaKey(id))
      if (!meta) continue // interrupted circle creation before meta commit
      circlesAffected++
      if (meta.ownerUserId === uid) {
        await storage.create(closedKey(id), { closedBy: uid, closedAt: now(),
          reason: 'owner_account_retired' })
      }
      const seated = await peers(id)
      const allUserIds = [...new Set([meta.ownerUserId,
        ...seated.map((seat) => seat.userId)])]
      const prefixes = [
        `circles/${id}/progress/${uid}/`,
        `circles/${id}/showcase/${uid}/`,
        `circles/${id}/reactions/${uid}/`,
        `circles/${id}/progress-claims/${uid}/`,
      ]
      // Also remove claps from OTHER members addressed to the retired actor.
      for (const otherUid of allUserIds) {
        if (otherUid !== uid) {
          prefixes.push(`circles/${id}/reactions/${otherUid}/${uid}/`)
        }
      }
      const targets = new Set()
      for (const prefix of prefixes) {
        const names = await storage.list(prefix)
        for (const name of names) {
          if (!name.startsWith(prefix)) throw new Error('Out-of-scope scrub key')
          targets.add(name)
        }
      }
      for (const name of targets) {
        await storage.remove(name)
        deleted++
      }
    }
    return {
      quarantined: true, circlesAffected, deleted,
      fullyErased: false, // structural identity and racing writers not purged
      followUpRequired: true,
    }
  }

  return Object.freeze({
    quarantineAccount, scrubAccountActivities,
    createCircle, joinCircle, rotateInvite, getCircle, leaveCircle: leave,
    removeMember, closeCircle, publishProgress, getProgress,
    reactProgress, getReactions, shareAchievement, getShowcase,
  })
}
