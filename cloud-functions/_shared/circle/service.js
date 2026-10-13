/* eslint-env node */
import crypto from 'node:crypto'
import { AppError } from '../core.js'
import { digest } from './event-log.js'
import { reduceCircle } from './reducer.js'

const fail = (status, code) => { throw new AppError(status, code, code) }
const valid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const op = (v) => { if (!valid(v)) fail(400, 'circle_operation_id_required'); return v }
const uid = (v) => { if (!valid(v)) fail(400, 'invalid_user'); return v }
const id = (v) => { if (!valid(v)) fail(400, 'invalid_circle'); return v }

/**
 * Isolated server kernel; NOT wired to HTTP or V4.
 * trustedAccess.check is an INDEPENDENT reliable identity/revocation authority,
 * not a Blob view or authenticate alone. It must cover actor, action, circle,
 * viewHash and all subjects, and fail closed on unknown state.
 * trustedAccess.revoke durably fences access BEFORE publishing revoke/close.
 * Checks around an asynchronous operation do not make network delivery atomic.
 */
export function createCircleService({ log, authenticate, trustedAccess, verifyAchievement, inviteKey } = {}) {
  if (!log?.scan || !log?.append || typeof authenticate !== 'function' ||
      typeof trustedAccess?.check !== 'function' || typeof inviteKey !== 'string' || inviteKey.length < 32) {
    throw new TypeError('Circle needs event log, independent trusted access and server invite key')
  }
  async function actor(token) {
    const auth = await authenticate(token)
    return uid(auth?.user?.userId ?? auth?.userId)
  }
  async function guard(token, actorUserId, context) {
    if (await actor(token) !== actorUserId ||
        await trustedAccess.check({ ...context, actorUserId, token }) !== true) {
      fail(403, 'circle_access_uncertain')
    }
  }
  async function snapshot(circleId) {
    const events = await log.scan(id(circleId))
    const view = reduceCircle(circleId, events)
    if (view.blocked || !view.meta) fail(503, 'circle_view_uncertain')
    if (view.closed) fail(410, 'circle_closed')
    return { view, events }
  }
  async function context(token, circleId, action, ownerOnly = false) {
    const actorUserId = await actor(token)
    await guard(token, actorUserId, { circleId: id(circleId), action, phase: 'before' })
    const { view, events } = await snapshot(circleId)
    if (ownerOnly && view.meta.ownerUserId !== actorUserId) fail(403, 'not_circle_owner')
    if (!view.members.some((m) => m.userId === actorUserId)) fail(403, 'not_circle_member')
    const proof = { circleId, action, viewHash: view.viewHash,
      subjects: view.members.map((m) => m.userId) }
    await guard(token, actorUserId, { ...proof, phase: 'after_scan' })
    return { actorUserId, view, events, proof }
  }
  async function write(token, ctx, type, operationId, payload) {
    await guard(token, ctx.actorUserId, { ...ctx.proof, phase: 'before_append' })
    const receipt = await log.append({ circleId: ctx.proof.circleId,
      actorUserId: ctx.actorUserId, type, operationId: op(operationId), payload })
    // Denied response does not roll back an event; external fence still applies.
    await guard(token, ctx.actorUserId, { ...ctx.proof, phase: 'after_append' })
    return receipt
  }
  async function fence(ctx, kind, targetUserId) {
    if (typeof trustedAccess.revoke !== 'function' ||
        await trustedAccess.revoke({ circleId: ctx.proof.circleId,
          actorUserId: ctx.actorUserId, targetUserId, kind }) !== true) {
      fail(503, 'circle_revocation_unavailable')
    }
  }
  return Object.freeze({
    async createCircle(token, { name, operationId, maxMembers = 12 } = {}) {
      const actorUserId = await actor(token)
      op(operationId)
      if (typeof name !== 'string' || !name.trim() || Array.from(name.trim().normalize('NFKC')).length > 32 ||
          Array.from(name).some((ch) => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127) ||
          !Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 12) {
        fail(400, 'invalid_circle_input')
      }
      const circleId = digest(['circle', actorUserId, operationId]).slice(0, 24)
      const secret = crypto.createHmac('sha256', inviteKey)
        .update(JSON.stringify([circleId, actorUserId, operationId])).digest('hex').slice(0, 32)
      const ctx = { actorUserId, proof: { circleId, action: 'create', subjects: [actorUserId] } }
      const receipt = await write(token, ctx, 'CIRCLE_CREATED', operationId,
        { name: name.trim().normalize('NFKC'), maxMembers, inviteHash: digest(secret) })
      return { ...receipt, circleId, inviteCode: 'QC2-' + circleId + '-' + secret }
    },
    async joinCircle(token, inviteCode) {
      const match = /^QC2-([a-f0-9]{24})-([a-f0-9]{32})$/.exec(inviteCode || '')
      if (!match) fail(404, 'invalid_invite')
      const circleId = match[1]
      const actorUserId = await actor(token)
      const proof = { circleId, action: 'request_join', subjects: [actorUserId] }
      await guard(token, actorUserId, { ...proof, phase: 'before' })
      const { view, events } = await snapshot(circleId)
      const creation = events.find((e) => e.type === 'CIRCLE_CREATED')
      const inviteHash = digest(match[2])
      if (!creation || creation.payload.inviteHash !== inviteHash) fail(404, 'invalid_invite')
      if (view.revoked.includes(actorUserId)) fail(403, 'membership_revoked')
      return { ...await write(token, { actorUserId, proof }, 'JOIN_REQUESTED',
        'join_request', { inviteHash }), circleId, admission: 'pending', final: false }
    },
    async getCircle(token, circleId) {
      const ctx = await context(token, circleId, 'read')
      await guard(token, ctx.actorUserId, { ...ctx.proof, phase: 'before_return' })
      const { pending, revoked, ...visible } = ctx.view
      return { ...visible, pendingCount: pending.length, revokedCount: revoked.length }
    },
    async leaveCircle(token, circleId) {
      const ctx = await context(token, circleId, 'leave')
      if (ctx.actorUserId === ctx.view.meta.ownerUserId) fail(403, 'owner_cannot_leave')
      await fence(ctx, 'member', ctx.actorUserId)
      // Fence intentionally denies the actor now; no post-fence private read.
      return log.append({ circleId, actorUserId: ctx.actorUserId,
        type: 'MEMBER_LEFT', operationId: 'leave_circle', payload: {} })
    },
    async removeMember(token, circleId, targetUserId) {
      uid(targetUserId)
      const ctx = await context(token, circleId, 'remove', true)
      if (targetUserId === ctx.actorUserId) fail(403, 'owner_cannot_leave')
      await fence(ctx, 'member', targetUserId)
      return log.append({ circleId, actorUserId: ctx.actorUserId, type: 'MEMBER_REMOVED',
        operationId: digest(['remove', targetUserId]), payload: { targetUserId } })
    },
    async closeCircle(token, circleId) {
      const ctx = await context(token, circleId, 'close', true)
      await fence(ctx, 'circle')
      return log.append({ circleId, actorUserId: ctx.actorUserId,
        type: 'CIRCLE_CLOSED', operationId: 'close_circle', payload: {} })
    },
    async publishProgress(token, circleId, day, input) {
      const ctx = await context(token, circleId, 'publish_progress')
      if (!input || typeof input.completed !== 'boolean' ||
          !Number.isInteger(input.newWords) || input.newWords < 0 || input.newWords > 256 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
          new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) {
        fail(400, 'invalid_progress')
      }
      return write(token, ctx, 'PROGRESS_PUBLISHED', op(input.eventId),
        { day, completed: input.completed, newWords: input.newWords })
    },
    async shareAchievement(token, circleId, achievementId) {
      const ctx = await context(token, circleId, 'share_achievement')
      if (!/^ACH_[A-Z0-9_]{3,72}$/.test(achievementId || '') ||
          typeof verifyAchievement !== 'function' ||
          await verifyAchievement(ctx.actorUserId, achievementId) !== true) {
        fail(403, 'achievement_unverified')
      }
      return write(token, ctx, 'ACHIEVEMENT_SHARED', digest(['achievement', achievementId]),
        { achievementId, verified: true })
    },
    async reactProgress(token, circleId, targetUserId, day) {
      uid(targetUserId)
      const ctx = await context(token, circleId, 'clap')
      if (targetUserId === ctx.actorUserId || !ctx.view.progress.some((p) =>
        p.authorUserId === targetUserId && p.day === day)) fail(404, 'progress_not_found')
      return write(token, ctx, 'CLAP_ADDED', digest(['clap', targetUserId, day]),
        { targetUserId, day })
    },
  })
}
