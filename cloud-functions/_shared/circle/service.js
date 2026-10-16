/* eslint-env node */
import crypto from 'node:crypto'
import { AppError } from '../core.js'
import { digest } from './event-log.js'
import { reduceCircle } from './reducer.js'
import { createCircleRevocationCoordinator, revocationCommand } from './revocation.js'

const fail = (status, code) => { throw new AppError(status, code, code) }
const valid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v)
const op = (v) => { if (!valid(v)) fail(400, 'circle_operation_id_required'); return v }
const uid = (v) => { if (!valid(v)) fail(400, 'invalid_user'); return v }
const calendarDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const id = (v) => { if (!valid(v)) fail(400, 'invalid_circle'); return v }

/**
 * Isolated server kernel (HTTP not mounted).
 *
 * accessModel='eventual' is the light-social product mode. The authenticated
 * account identity is rechecked at request boundaries; membership,
 * owner rights and revocation come from the visible Blob event replay.
 * A remote node may retain an old view until the Blob convergence window.
 * This is deliberately NOT immediate/global access revocation, and the raw
 * Blob objects must remain server-private.
 *
 * accessModel='fenced' preserves the historical independently-authorized
 * experimental contract for compatibility tests; it is not a requirement for
 * light-social Circle launch. Retirement/physical erasure remain separate.
 */
export function createCircleService({
  log, authenticate, trustedAccess, inviteKey, accessModel = 'fenced',
} = {}) {
  if (accessModel !== 'eventual' && accessModel !== 'fenced') {
    throw new TypeError('Unknown Circle access model')
  }
  if (!log?.scan || !log?.append || typeof authenticate !== 'function' ||
      (inviteKey !== undefined && (typeof inviteKey !== 'string' || inviteKey.length < 32)) ||
      (accessModel === 'fenced' && typeof trustedAccess?.check !== 'function')) {
    throw new TypeError('Circle needs event log, independent trusted access in fenced mode and server invite key')
  }
  if (accessModel === 'eventual' && trustedAccess !== undefined) {
    throw new TypeError('Eventual Circle must not silently mix fencing models')
  }
  const revocations = accessModel === 'fenced'
    ? createCircleRevocationCoordinator({ log, trustedAccess })
    : null
  async function actor(token) {
    const auth = await authenticate(token)
    return uid(auth?.user?.userId ?? auth?.userId)
  }
  async function guard(token, actorUserId, context) {
    if (await actor(token) !== actorUserId ||
        (accessModel === 'fenced' &&
          await trustedAccess.check({ ...context, actorUserId, token }) !== true)) {
      fail(403, 'circle_access_uncertain')
    }
  }
  async function snapshot(circleId) {
    let events
    try { events = await log.scan(id(circleId)) }
    catch { fail(503, 'circle_view_uncertain') }
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
    // Eventual mode rechecks session only. This receipt is NOT a final
    // global membership/authorization result; stale nodes may disagree.
    await guard(token, ctx.actorUserId, { ...ctx.proof, phase: 'after_append' })
    return receipt
  }
  async function readView(token, circleId) {
    const ctx = await context(token, circleId, 'read')
    await guard(token, ctx.actorUserId, { ...ctx.proof, phase: 'before_return' })
    const { pending, revoked, ...visible } = ctx.view
    return { ...visible, pendingCount: pending.length, revokedCount: revoked.length }
  }
  return Object.freeze({
    async createCircle(token, { name, operationId, softMemberLimit, maxMembers } = {}) {
      const memberHint = softMemberLimit ?? maxMembers ?? 12
      const actorUserId = await actor(token)
      op(operationId)
      if (typeof name !== 'string' || !name.trim() || Array.from(name.trim().normalize('NFKC')).length > 32 ||
          Array.from(name).some((ch) => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127) ||
          !Number.isInteger(memberHint) || memberHint < 2 || memberHint > 100 ||
          (softMemberLimit !== undefined && maxMembers !== undefined && softMemberLimit !== maxMembers)) {
        fail(400, 'invalid_circle_input')
      }
      // Production requires no deployment secret. In that mode, operationId
      // MUST contain >=122 bits of client-generated UUIDv4 entropy, because
      // it also acts as an unrecoverable private HMAC key for this invitation.
      // Keeping the same operationId preserves deterministic retry semantics.
      if (inviteKey === undefined &&
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(operationId)) {
        fail(400, 'circle_random_operation_id_required')
      }
      const circleId = digest(['circle', actorUserId, operationId]).slice(0, 24)
      const secret = crypto.createHmac('sha256', inviteKey ?? operationId)
        .update(JSON.stringify([circleId, actorUserId, operationId])).digest('hex').slice(0, 32)
      const ctx = { actorUserId, proof: { circleId, action: 'create', subjects: [actorUserId] } }
      const receipt = await write(token, ctx, 'CIRCLE_CREATED', operationId,
        { name: name.trim().normalize('NFKC'), softMemberLimit: memberHint, inviteHash: digest(secret) })
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
    getCircle: readView,
    async getProgress(token, circleId, day) {
      if (!calendarDay(day)) fail(400, 'invalid_day')
      return (await readView(token, circleId)).progress.filter((p) => p.day === day)
    },
    async getReactions(token, circleId, targetUserId, day) {
      uid(targetUserId)
      if (!calendarDay(day)) fail(400, 'invalid_day')
      const view = await readView(token, circleId)
      if (!view.progress.some((p) => p.authorUserId === targetUserId && p.day === day)) {
        fail(404, 'progress_not_found')
      }
      return { count: view.claps.filter((c) => c.authorUserId === targetUserId && c.day === day).length,
        consistency: 'eventual' }
    },
    async getShowcase(token, circleId, targetUserId, ids = []) {
      uid(targetUserId)
      if (!Array.isArray(ids) || ids.length > 24 ||
          ids.some((id) => typeof id !== 'string' || !/^ACH_[A-Z0-9_]{3,72}$/.test(id))) {
        fail(400, 'invalid_achievement')
      }
      const view = await readView(token, circleId)
      if (!view.members.some((m) => m.userId === targetUserId)) fail(404, 'member_not_found')
      return view.achievements.filter((a) => a.authorUserId === targetUserId &&
        (!ids.length || ids.includes(a.achievementId)))
    },
    async leaveCircle(token, circleId) {
      const ctx = await context(token, circleId, 'leave')
      if (ctx.actorUserId === ctx.view.meta.ownerUserId) fail(403, 'owner_cannot_leave')
      const command = revocationCommand({
        circleId, actorUserId: ctx.actorUserId, type: 'MEMBER_LEFT',
      })
      return accessModel === 'eventual'
        ? { ...await write(token, ctx, command.type, command.operationId, command.payload),
          consistency: 'eventual', final: false }
        : revocations.execute({ token, proof: ctx.proof, command })
    },
    async removeMember(token, circleId, targetUserId) {
      uid(targetUserId)
      const ctx = await context(token, circleId, 'remove', true)
      if (targetUserId === ctx.actorUserId) fail(403, 'owner_cannot_leave')
      const command = revocationCommand({
        circleId, actorUserId: ctx.actorUserId, type: 'MEMBER_REMOVED', targetUserId,
      })
      return accessModel === 'eventual'
        ? { ...await write(token, ctx, command.type, command.operationId, command.payload),
          consistency: 'eventual', final: false }
        : revocations.execute({ token, proof: ctx.proof, command })
    },
    async closeCircle(token, circleId) {
      const ctx = await context(token, circleId, 'close', true)
      const command = revocationCommand({
        circleId, actorUserId: ctx.actorUserId, type: 'CIRCLE_CLOSED',
      })
      return accessModel === 'eventual'
        ? { ...await write(token, ctx, command.type, command.operationId, command.payload),
          consistency: 'eventual', final: false }
        : revocations.execute({ token, proof: ctx.proof, command })
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
      if (typeof achievementId !== 'string' || !/^ACH_[A-Z0-9_]{3,72}$/.test(achievementId)) fail(400, 'invalid_achievement')
      return write(token, ctx, 'ACHIEVEMENT_SHARED', digest(['social-achievement', achievementId]),
        { achievementId, selfReported: true })
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

/**
 * Preferred light-social entry point. Explicitly accepts up to the provider's
 * propagation delay for leave/remove/close; it needs no atomic write, CAS,
 * external fencing service or revocation receipt store.
 */
export function createCircleEventualService({ log, authenticate, inviteKey } = {}) {
  return createCircleService({ log, authenticate, inviteKey, accessModel: 'eventual' })
}
