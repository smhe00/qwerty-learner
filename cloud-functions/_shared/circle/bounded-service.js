import { normalizeCircleNickname } from './nickname.js'
import { createCircleRoster, membership, validateMembership } from './roster.js'
import { normalizeCirclePassphrase } from './passphrase.js'
/* eslint-env node */
import crypto from 'node:crypto'
import { digest } from './event-log.js'
import { USER, calendarDay, fail, mapBounded, root, windowDays } from './bounded-storage.js'
import { activityKey, createDailyViews, filterDailyView } from './daily-view.js'

const userId = (id) => {
  if (!USER.test(id || '')) fail(400, 'invalid_user_id')
  return id
}
const memberKey = (id, user) => root(id) + 'members/' + userId(user) + '.json'
const indexKey = (id, user) => 'social/v3/accounts/' + userId(user) + '/circles/' + id + '.json'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

function publicDaily(data) {
  const { claps, ...visible } = data
  const counts = new Map()
  for (const clap of claps) {
    const key = clap.authorUserId + '/' + clap.day
    const prior = counts.get(key)
    counts.set(key, { authorUserId: clap.authorUserId, day: clap.day, count: (prior?.count || 0) + 1 })
  }
  return { ...visible, reactionCounts: [...counts.values()] }
}

/** Seven-day light social service. Admission limits are observed checks, not locks.
 * Acknowledged control writes passed strong readback; races may change them afterwards.
 */
export function createCircleBoundedService({ storage, authenticate, now = Date.now, legacy, hasLegacyCircle } = {}) {
  if (!storage?.get || typeof authenticate !== 'function' || typeof now !== 'function') {
    throw new TypeError('Circle storage, authenticated session and clock required')
  }
  const phrase = value => { const text = normalizeCirclePassphrase(value); if (text === null) fail(400, 'invalid_circle_passphrase'); return text }
  const phraseHash = text => digest(['circle-passphrase-v1', text])
  const phrasePrefix = hash => 'social/v3/passphrases/' + hash + '/'
  const phraseKey = (hash, id) => phrasePrefix(hash) + id + '.json'
  async function phraseMatches(hash) {
    const keys = await storage.keys(phrasePrefix(hash), { maxKeys: 100 })
    const matches = await mapBounded(keys, async key => {
      const id = key.slice(phrasePrefix(hash).length, -5)
      const info = await meta(id)
      return info?.inviteMode === 'custom' && info.inviteHash === hash && !await isClosed(id) ? id : null
    })
    return matches.filter(Boolean)
  }
  async function available(hash, id) {
    if ((await phraseMatches(hash)).some(other => other !== id)) fail(409, 'circle_passphrase_taken')
  }
  async function indexPhrase(hash, id, user) {
    await storage.put(phraseKey(hash, id), { schemaVersion: 3, circleId: id, inviteHash: hash }, user)
  }
  const daily = createDailyViews(storage)
  const roster = createCircleRoster(storage)
  const identity = async (token) => {
    const auth = await authenticate(token)
    const id = auth?.user?.userId ?? auth?.userId
    if (!USER.test(id || '')) fail(401, 'invalid_session')
    return { userId: id, username: auth?.user?.username ?? auth?.username }
  }
  const actor = async token => (await identity(token)).userId
  const nicknameInput = value => {
    if (value === undefined) return undefined
    const text = normalizeCircleNickname(value)
    if (text === null) fail(400, 'invalid_circle_nickname')
    return text
  }
  const displayName = (value, profile) => value || normalizeCircleNickname(profile.username) || undefined
  async function recheck(token, id) {
    if (await actor(token) !== id) fail(401, 'invalid_session')
  }
  async function meta(id) {
    const value = await storage.get(root(id) + 'meta.json')
    if (value === null) return null
    if (value?.schemaVersion !== 3 || value.circleId !== id || !USER.test(value.ownerUserId || '') ||
        typeof value.name !== 'string' || !/^[a-f0-9]{64}$/.test(value.inviteHash || '') ||
        !Number.isInteger(value.softMemberLimit) || value.softMemberLimit < 2 || value.softMemberLimit > 50) {
      fail(503, 'circle_control_uncertain')
    }
    if (value.inviteText !== undefined && (value.inviteMode !== 'custom' ||
        normalizeCirclePassphrase(value.inviteText) !== value.inviteText || phraseHash(value.inviteText) !== value.inviteHash)) {
      fail(503, 'circle_control_uncertain')
    }
    return value
  }
  async function isClosed(id) {
    const value = await storage.get(root(id) + 'closed.json')
    if (value === null) return false
    if (value?.schemaVersion !== 3 || value.circleId !== id || value.closed !== true) {
      fail(503, 'circle_control_uncertain')
    }
    return true
  }
  async function memberRecord(id, user) {
    return validateMembership(await storage.get(memberKey(id, user)), id, user)
  }
  async function isMember(id, user) { return (await memberRecord(id, user)) !== null }
  async function members(id, owner, withNames = false) {
    if (withNames) return (await roster(id)).map(({userId, nickname}) => ({userId,
      role: userId === owner ? 'owner' : 'member', status: 'member', ...(nickname ? {nickname} : {})}))
    const prefix = root(id) + 'members/'
    const keys = await storage.keys(prefix, { maxKeys: 500 })
    return keys.map(key => {
      const uid = key.slice(prefix.length, -5)
      if (!USER.test(uid)) fail(503, 'circle_membership_uncertain')
      return {userId:uid, role:uid === owner ? 'owner' : 'member', status:'member'}
    })
  }
  async function mine(user) {
    const prefix = 'social/v3/accounts/' + user + '/circles/'
    const keys = await storage.keys(prefix, { maxKeys: 1000 })
    const items = await mapBounded(keys, async (key) => {
      const id = key.slice(prefix.length, -5)
      const info = await meta(id)
      if (!info) return null
      const [closed, joined] = await Promise.all([isClosed(id), isMember(id, user)])
      if (closed) {
        // A closed circle never reopens; unlike an in-flight join, this index is safe to prune.
        await storage.remove(key, user)
        return null
      }
      if (!joined) return null
      return { circleId: id, name: info.name, role: info.ownerUserId === user ? 'owner' : 'member' }
    })
    // A dangling index is not membership. Do not delete during a read: a join may
    // be between index and membership writes. Retrying that join repairs it.
    return items.filter(Boolean)
  }
  async function context(token, id, ownerOnly = false, allowClosed = false, allowAbsent = false, routeLegacy = false) {
    const user = await actor(token)
    const [info, closed, joined] = await Promise.all([meta(id), allowClosed ? false : isClosed(id), allowAbsent ? true : isMember(id, user)])
    if (!info && routeLegacy && legacy) return { user, info: null }
    if (!info) fail(404, 'circle_not_found')
    if (ownerOnly && info.ownerUserId !== user) fail(403, 'not_circle_owner')
    if (closed) fail(410, 'circle_closed')
    if (!joined) fail(403, 'not_circle_member')
    return { user, info }
  }
  async function finalContext(token, id, user) {
    // Finish storage checks before the final fresh session check. This replaces
    // a context+recheck pair, not the final revocation/membership boundary.
    const [info, closed, joined] = await Promise.all([meta(id), isClosed(id), isMember(id, user)])
    await recheck(token, user)
    if (!info) fail(404, 'circle_not_found')
    if (closed) fail(410, 'circle_closed')
    if (!joined) fail(403, 'not_circle_member')
    return {user, info}
  }
  const checkDay = (day) => {
    if (!calendarDay(day)) fail(400, 'invalid_day')
    if (!windowDays(now()).includes(day)) fail(410, 'circle_day_expired')
    return day
  }
  const receipt = (circleId) => ({ circleId, schemaVersion: 3, consistency: 'strong',
    readbackConfirmed: true, final: false })
  async function attach(id, user, token, nickname, indexed = false) {
    await recheck(token, user)
    // The durable index precedes membership, so a committed membership remains discoverable.
    if (!indexed) await storage.put(indexKey(id, user), membership(id, user), user)
    await storage.put(memberKey(id, user), membership(id, user, nickname), user)
    if (await isClosed(id)) fail(410, 'circle_closed')
    await recheck(token, user)
    return { ...receipt(id), admission: 'member' }
  }
  async function detach(id, target, actorId) {
    await storage.remove(memberKey(id, target), actorId)
    await storage.remove(indexKey(id, target), actorId)
    return receipt(id)
  }
  async function dayView(token, id, day, initial) {
    const { user, info } = initial || await context(token, id)
    checkDay(day)
    const [data, current] = await Promise.all([daily.read(id, day), members(id, info.ownerUserId, true)])
    // Fresh context rechecks session, membership, closure and invitation after I/O.
    const latest = await finalContext(token, id, user)
    return { ...filterDailyView(data, current), members: current, info: latest.info, requester: user }
  }
  async function writeActivity(token, id, day, type, payload, initial) {
    const { user } = initial || await context(token, id)
    checkDay(day)
    const record = { schemaVersion: 3, circleId: id, day, actorUserId: user, type, payload }
    await recheck(token, user)
    await storage.put(activityKey(record), record, user)
    await finalContext(token, id, user)
    return { circleId: id, day, schemaVersion: 3, consistency: 'eventual', final: false,
      operationKey: digest(record) }
  }
  async function fullView(token, id, day, initial) {
    const { info, members, ...data } = await dayView(token, id, day, initial)
    // dayView revalidates the caller; only its owner can retrieve stored invitation text.
    // The identity is bound to the authenticated request, not a caller-supplied user ID.
    const requester = data.requester
    delete data.requester
    return { schemaVersion: 3, circleId: id, consistency: 'eventual', membershipConsistency: 'strong',
      final: false, day, retainedDays: windowDays(now()), meta: { name: info.name,
        ownerUserId: info.ownerUserId, softMemberLimit: info.softMemberLimit,
        inviteMode: info.inviteMode || 'legacy', inviteRevision: info.inviteRevision || 'legacy' },
      ...(requester === info.ownerUserId && info.inviteText !== undefined ? { ownerInviteCode: info.inviteText } : {}),
      members, ...publicDaily(data), capacity: { softMemberLimit: info.softMemberLimit,
        memberCount: members.length, aboveSoftLimit: members.length > info.softMemberLimit, hardLimit: false } }
  }
  const service = {
    async createCircle(token, { name, operationId, softMemberLimit, passphrase, nickname } = {}) {
      const profile = await identity(token)
      const user = profile.userId
      nickname = nicknameInput(nickname)
      if (typeof operationId !== 'string' || !UUID.test(operationId)) fail(400, 'circle_random_operation_id_required')
      // A retry of a legacy creation must not create a second Circle.
      if (legacy && hasLegacyCircle && await hasLegacyCircle(digest(['circle', user, operationId]).slice(0, 24))) {
        return legacy.createCircle(token, { name, operationId, softMemberLimit })
      }
      softMemberLimit ??= 50
      if (typeof name !== 'string' || !name.trim() || Array.from(name.trim().normalize('NFKC')).length > 32 ||
          Array.from(name).some((c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127) ||
          !Number.isInteger(softMemberLimit) || softMemberLimit < 2 || softMemberLimit > 50) fail(400, 'invalid_circle_input')
      const id = digest(['circle-v3', user, operationId]).slice(0, 24)
      const secret = crypto.createHmac('sha256', operationId)
        .update(JSON.stringify([id, user, operationId])).digest('hex').slice(0, 32)
      const custom = passphrase === undefined ? undefined : phrase(passphrase)
      const value = { schemaVersion: 3, circleId: id, ownerUserId: user,
        name: name.trim().normalize('NFKC'), softMemberLimit, inviteHash: custom === undefined ? digest(secret) : phraseHash(custom),
        ...(custom === undefined ? {} : { inviteMode: 'custom' }) }
      const fingerprint = digest({ ...value, ...(nickname === undefined ? {} : { creationNickname: nickname }) })
      const previous = await meta(id)
      if (previous && (previous.creationFingerprint || digest(previous)) !== fingerprint) fail(409, 'circle_operation_conflict')
      if (await isClosed(id)) fail(410, 'circle_closed')
      const existing = await memberRecord(id, user)
      if (!existing && (await mine(user)).length >= 3) fail(409, 'circle_account_limit')
      if (!previous && custom !== undefined) await available(value.inviteHash, id)
      // Index before metadata also keeps partial creations discoverable for retry.
      await recheck(token, user)
      await storage.put(indexKey(id, user), membership(id, user), user)
      if (!previous) {
        if (custom !== undefined) await indexPhrase(value.inviteHash, id, user)
        await storage.put(root(id) + 'meta.json', { ...value, creationFingerprint: fingerprint,
          ...(custom === undefined ? {} : { inviteRevision: operationId, inviteText: custom }) }, user)
      }
      const active = previous || value
      return { ...await attach(id, user, token, existing?.nickname || displayName(nickname, profile), true), name: active.name, role: 'owner', inviteRevision: active.inviteRevision || (custom === undefined ? 'legacy' : operationId),
        ...(active.inviteHash === value.inviteHash ? { inviteCode: custom ?? ('QC3-' + id + '-' + secret) } : { inviteChanged: true }) }
    },
    async joinCircle(token, inviteCode, { nickname } = {}) {
      const profile = await identity(token)
      const user = profile.userId
      nickname = nicknameInput(nickname)
      if (typeof inviteCode === 'string' && /^QC2-[a-f0-9]{24}-[a-f0-9]{32}$/.test(inviteCode) && legacy) {
        return legacy.joinCircle(token, inviteCode)
      }
      const match = /^QC3-([a-f0-9]{24})-([a-f0-9]{32})$/.exec(inviteCode || '')
      const custom = match ? undefined : phrase(inviteCode)
      const hash = match ? digest(match[2]) : phraseHash(custom)
      const matches = match ? [match[1]] : await phraseMatches(hash)
      if (matches.length > 1) fail(409, 'circle_passphrase_conflict')
      if (!matches.length) fail(404, 'invalid_invite')
      const id = matches[0]
      const info = await meta(id)
      if (!info || info.inviteHash !== hash || (match && info.inviteMode === 'custom')) fail(404, 'invalid_invite')
      if (await isClosed(id)) fail(410, 'circle_closed')
      const existing = await memberRecord(id, user)
      if (!existing) {
        if ((await mine(user)).length >= 3) fail(409, 'circle_account_limit')
        if ((await members(id, info.ownerUserId)).length >= info.softMemberLimit) fail(409, 'circle_member_limit')
      }
      const result = await attach(id, user, token, nickname === undefined && existing?.nickname ? existing.nickname : displayName(nickname, profile))
      // Never acknowledge a different invitation after a concurrent owner change.
      const current = await meta(id)
      if (current.inviteHash !== hash) fail(409, 'circle_invite_changed')
      return { ...result, name: current.name, role: current.ownerUserId === user ? 'owner' : 'member', inviteRevision: current.inviteRevision || 'legacy' }
    },
    async setPassphrase(token, id, input = {}) {
      const { user, info } = await context(token, id, true)
      const text = phrase(input.passphrase)
      const hash = phraseHash(text)
      await available(hash, id)
      await recheck(token, user)
      await indexPhrase(hash, id, user)
      const revision = info.inviteMode === 'custom' && info.inviteHash === hash ? info.inviteRevision : crypto.randomUUID()
      const next = { ...info, creationFingerprint: info.creationFingerprint || digest(info),
        inviteMode: 'custom', inviteHash: hash, inviteRevision: revision, inviteText: text }
      await storage.put(root(id) + 'meta.json', next, user)
      if (info.inviteMode === 'custom' && info.inviteHash !== hash) await storage.remove(phraseKey(info.inviteHash, id), user)
      await context(token, id, true)
      return { ...receipt(id), inviteCode: text, inviteRevision: revision }
    },
    async listMyCircles(token) {
      const user = await actor(token)
      const items = await mine(user)
      await recheck(token, user)
      return { circles: items, schemaVersion: 3, consistency: 'strong', legacyIncluded: false, softCircleLimit: 3, hardLimit: false }
    },
    async getCircle(token, id) {
      // The same initial context also decides legacy routing. Do not repeat
      // session + metadata reads solely to discover a v3 circle's version.
      const initial = await context(token, id, false, false, false, true)
      return initial.info ? fullView(token, id, windowDays(now())[0], initial) : legacy.getCircle(token, id)
    },
    async getDay(token, id, day) { return fullView(token, id, day) },
    async getProgress(token, id, day) { return (await dayView(token, id, day)).progress },
    async publishProgress(token, id, day, input) {
      if (!input || !/^[A-Za-z0-9_-]{8,128}$/.test(input.eventId || '') ||
          typeof input.completed !== 'boolean' || !Number.isInteger(input.newWords) ||
          input.newWords < 0 || input.newWords > 256) fail(400, 'invalid_progress')
      const initial = await context(token, id, false, false, false, true)
      if (!initial.info) return legacy.publishProgress(token, id, day, input)
      return writeActivity(token, id, day, 'progress',
        { eventId: input.eventId, completed: input.completed, newWords: input.newWords }, initial)
    },
    async reactProgress(token, id, target, day) {
      userId(target)
      const initial = await context(token, id, false, false, false, true)
      if (!initial.info) return legacy.reactProgress(token, id, target, day)
      checkDay(day)
      const [data, joined] = await Promise.all([daily.read(id, day), isMember(id, target)])
      if (initial.user === target || !joined || !data.progress.some((p) => p.authorUserId === target)) fail(404, 'progress_not_found')
      // A clap needs only its target's current membership/progress, not every
      // member's nickname. writeActivity still checks live auth before writing
      // and final membership/closure/session after writing.
      return writeActivity(token, id, day, 'clap', { targetUserId: target }, initial)
    },
    async getReactions(token, id, target, day) {
      userId(target)
      const view = await dayView(token, id, day)
      if (!view.progress.some((p) => p.authorUserId === target)) fail(404, 'progress_not_found')
      return { count: view.claps.filter((c) => c.authorUserId === target).length, consistency: 'eventual' }
    },
    async shareAchievement(token, id, achievementId) {
      if (!/^ACH_[A-Z0-9_]{3,72}$/.test(achievementId || '')) fail(400, 'invalid_achievement')
      return writeActivity(token, id, windowDays(now())[0], 'achievement', { achievementId })
    },
    async getShowcase(token, id, target, ids = []) {
      userId(target)
      if (!Array.isArray(ids) || ids.length > 24 || ids.some((v) => !/^ACH_[A-Z0-9_]{3,72}$/.test(v))) {
        fail(400, 'invalid_achievement')
      }
      await context(token, id)
      const all = []
      for (const day of windowDays(now())) {
        const view = await dayView(token, id, day)
        if (!view.members.some((m) => m.userId === target)) fail(404, 'member_not_found')
        all.push(...view.achievements.filter((a) => a.authorUserId === target && (!ids.length || ids.includes(a.achievementId))))
      }
      await context(token, id)
      return [...new Map(all.map((a) => [a.achievementId, a])).values()]
    },
    async leaveCircle(token, id) {
      const { user, info } = await context(token, id, false, true, true)
      if (info.ownerUserId === user) fail(403, 'owner_cannot_leave')
      // Idempotent after a lost DELETE response; only the authenticated user's keys.
      await recheck(token, user)
      const result = await detach(id, user, user)
      await recheck(token, user)
      return result
    },
    async removeMember(token, id, target) {
      userId(target)
      const { user } = await context(token, id, true)
      if (target === user) fail(403, 'owner_cannot_leave')
      await recheck(token, user)
      const result = await detach(id, target, user)
      await recheck(token, user)
      return result
    },
    async closeCircle(token, id) {
      const { user, info } = await context(token, id, true, true)
      await recheck(token, user)
      await storage.put(root(id) + 'closed.json', { schemaVersion: 3, circleId: id, closed: true }, user)
      if (info.inviteMode === 'custom') await storage.remove(phraseKey(info.inviteHash, id), user)
      // Closure is authoritative. Per-account listings exclude closed circles;
      // their indexes need no mass rewrite, and retries cannot reopen the circle.
      await recheck(token, user)
      return receipt(id)
    },
  }
  // Read/write old circles through the unchanged v2 service. QC3 creates distinct IDs.
  if (legacy) {
    for (const method of ['leaveCircle', 'removeMember', 'closeCircle',
      'getProgress', 'getReactions', 'shareAchievement', 'getShowcase']) {
      const current = service[method]
      service[method] = async (token, id, ...args) => {
        await actor(token)
        return await meta(id) === null ? legacy[method](token, id, ...args) : current(token, id, ...args)
      }
    }
  }
  return Object.freeze(service)
}
