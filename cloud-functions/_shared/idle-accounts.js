/* eslint-env node */
import crypto from 'node:crypto'
import { withRetry } from './storage/edgeone-blob.js'
import { AppError } from './core.js'

export const DAY_MS = 86400000
export const IDLE_DAYS = 180
// A fence outlives any Maker request. A later activity-triggered pass deletes.
export const DRAIN_MS = DAY_MS
const HASH = /^[a-f0-9]{64}$/
const USER = /^[a-f0-9]{32}$/
class BudgetExceeded extends Error {}

/** Server-only configuration. A display name can never grant privileges. */
export function isAdministrator(identity, adminUserId) {
  return USER.test(adminUserId || '') && identity?.userId === adminUserId &&
    identity?.normalizedUsername === 'smhe' && identity?.status === 'active'
}

export function createIdleAccounts({ store, adminUserId = '', startAt, execute = false,
  clock = Date.now } = {}) {
  const start = Date.parse(startAt || '')
  const configured = Number.isFinite(start)
  let deadline = Infinity
  function checkBudget() { if (clock() >= deadline) throw new BudgetExceeded() }
  const get = key => { checkBudget(); return withRetry(() => store.get(key, { type: 'json', consistency: 'strong' })) }
  const set = (key, value) => { checkBudget(); return withRetry(() => store.setJSON(key, value)) }
  const remove = key => { checkBudget(); return withRetry(() => store.delete(key)) }
  const list = async prefix => {
    checkBudget()
    const result = await withRetry(() => store.list({ prefix, consistency: 'strong' }))
    if (!Array.isArray(result?.blobs)) throw new Error('Incomplete Blob listing')
    if (result.blobs.some(blob => typeof blob.key !== 'string' || !blob.key.startsWith(prefix))) {
      throw new Error('Out-of-scope Blob listing')
    }
    return result.blobs
  }
  const root = id => `maintenance/idle/v1/${id}/`
  const identityKey = hash => `accounts/${hash}/identity.json`
  const fenceKey = id => root(id) + 'fence.json'
  const deletingKey = id => root(id) + 'deleting.json'
  const protectedAccount = identity => identity.userId === adminUserId ||
    identity.normalizedUsername === 'smhe'
  function validate(identity) {
    if (!HASH.test(identity?.usernameHash || '') || !USER.test(identity?.userId || '')) {
      throw new Error('Invalid account identity')
    }
  }

  async function snapshot(identity) {
    validate(identity)
    let last = Math.max(start, Date.parse(identity.createdAt))
    if (!Number.isFinite(last)) throw new Error('Invalid account timestamp')
    for (const blob of await list(root(identity.userId) + 'days/')) {
      const match = /\/days\/(\d{4}-\d{2}-\d{2})\.json$/.exec(blob.key)
      if (!match) throw new Error('Invalid activity key')
      const end = Date.parse(match[1] + 'T00:00:00.000Z') + DAY_MS
      if (!Number.isFinite(end) || end > clock() + DAY_MS) throw new Error('Invalid activity timestamp')
      last = Math.max(last, end)
    }
    const expiresAt = last + IDLE_DAYS * DAY_MS
    return { lastActiveAt: new Date(last).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
      eligible: clock() >= expiresAt, protected: protectedAccount(identity) }
  }

  // Called only AFTER password/session validation, BEFORE issuing access.
  // Deterministic daily keys cannot regress through out-of-order writers.
  async function touch(identity) {
    if (!configured) return
    validate(identity)
    const deleting = await get(deletingKey(identity.userId))
    const fence = await get(fenceKey(identity.userId))
    if (deleting || fence) {
      // A returning user during the drain window requests cancellation. Never
      // claim login success until the maintenance worker has removed the fence.
      if (!deleting && fence?.phase === 'draining') {
        await set(root(identity.userId) + 'return.json', { requested: true })
      }
      throw new AppError(423, 'account_cleanup_pending',
        'Account maintenance is in progress; please retry after maintenance')
    }
    const day = new Date(clock()).toISOString().slice(0, 10)
    const key = root(identity.userId) + `days/${day}.json`
    if (await get(key) === null) await set(key, { day })
    // A concurrent fence must prevent this request from starting work.
    if (await get(deletingKey(identity.userId)) || await get(fenceKey(identity.userId))) {
      throw new AppError(423, 'account_cleanup_pending', 'Account maintenance is in progress')
    }
  }

  async function beforeRegister(usernameHash) {
    if (!HASH.test(usernameHash)) throw new Error('Invalid registration selector')
    if (USER.test(adminUserId) && usernameHash === crypto.createHash('sha256').update('smhe').digest('hex')) {
      throw new AppError(409, 'administrator_account_reserved', 'Administrator identity is reserved')
    }
    const retired = await get(`maintenance/idle-retired/v1/${usernameHash}.json`)
    if (retired && (!Number.isFinite(retired.completedAt) || clock() < retired.completedAt + DRAIN_MS)) {
      throw new AppError(409, 'username_cleanup_pending', 'Username retirement is still in progress')
    }
  }

  async function requireAdmin(identity) {
    if (!isAdministrator(identity, adminUserId)) {
      throw new AppError(403, 'administrator_required', 'Administrator access required')
    }
  }

  async function inspect(identity) {
    if (!configured) return { enabled: false, idleDays: IDLE_DAYS }
    return { enabled: true, idleDays: IDLE_DAYS, ...await snapshot(identity) }
  }

  async function usage() {
    const blobs = await list('')
    const measured = blobs.filter(blob => Number.isFinite(blob.size) && blob.size >= 0)
    return { objects: blobs.length,
      accounts: blobs.filter(blob => /^accounts\/[a-f0-9]{64}\/identity\.json$/.test(blob.key)).length,
      reportedBytes: measured.reduce((sum, blob) => sum + blob.size, 0),
      sizeComplete: measured.length === blobs.length }
  }

  async function processAccount(identity, dryRun) {
    validate(identity)
    const policy = await snapshot(identity)
    const base = { userId: identity.userId, username: identity.username, ...policy }
    if (policy.protected) return { ...base, action: 'protected' }
    const circleHold = await get(`social/v2/accounts/${identity.userId}/used.json`) !== null
    const deleting = await get(deletingKey(identity.userId))
    const fence = await get(fenceKey(identity.userId)) || (deleting
      ? { phase: 'deleting', createdAt: deleting.createdAt, userId: deleting.userId } : null)
    if (circleHold) {
      // A social event from a request already in flight can arrive after the
      // initial fence. Do not strand that account in a pre-deletion fence.
      if (!dryRun && fence && !deleting) {
        const day = new Date(clock()).toISOString().slice(0, 10)
        await set(root(identity.userId) + `days/${day}.json`, { day })
        await remove(fenceKey(identity.userId))
        await remove(root(identity.userId) + 'return.json')
      }
      return { ...base, action: 'circle_hold' }
    }
    if (!policy.eligible && !fence && !deleting) return { ...base, action: 'retain' }
    if (dryRun) return { ...base, action: deleting ? 'deleting' : fence ? fence.phase : 'candidate' }
    const current = await get(identityKey(identity.usernameHash))
    if (current?.userId !== identity.userId || current?.status !== 'active') {
      return { ...base, action: 'identity_changed' }
    }
    if (!fence) {
      await set(fenceKey(identity.userId), {
        phase: 'draining', createdAt: clock(), userId: identity.userId,
      })
      return { ...base, action: 'draining' }
    }
    if (fence.userId !== identity.userId || !Number.isFinite(fence.createdAt) ||
        !['draining', 'deleting'].includes(fence.phase)) throw new Error('Invalid deletion fence')
    if (!deleting && fence.phase === 'draining') {
      if (await get(root(identity.userId) + 'return.json') !== null || !policy.eligible) {
        // Extend activity BEFORE reopening access; a failed reopen is retryable.
        const day = new Date(clock()).toISOString().slice(0, 10)
        await set(root(identity.userId) + `days/${day}.json`, { day })
        await remove(fenceKey(identity.userId))
        await remove(root(identity.userId) + 'return.json')
        return { ...base, action: 'cancelled' }
      }
      if (clock() - fence.createdAt < DRAIN_MS) return { ...base, action: 'draining' }
      // An immutable second marker cannot be overwritten by an overlapping
      // worker that saw an earlier draining state.
      await set(deletingKey(identity.userId), { userId: identity.userId, createdAt: fence.createdAt })
    }
    // Reserve the old username while workers drain. Registration cannot reuse
    // account/auth key names until 24h after finalization; immutable user IDs
    // remain distinct even if the display name is later registered again.
    const retiredKey = `maintenance/idle-retired/v1/${identity.usernameHash}.json`
    await set(retiredKey, { userId: identity.userId, completedAt: null })
    // Check the social hold again after all in-flight requests have drained.
    if (await get(`social/v2/accounts/${identity.userId}/used.json`) !== null) {
      throw new Error('Circle data requires independent cleanup')
    }
    // Identity is deleted LAST. A failed pass can resume without credentials
    // or a recursive wildcard outside this immutable user's namespaces.
    let deletedObjects = 0
    const prefixes = [`users/${identity.userId}/`, `accounts/${identity.usernameHash}/`]
    for (const prefix of prefixes) {
      const entries = await list(prefix)
      for (const blob of entries) {
        if (!blob.key.startsWith(prefix)) throw new Error('Out-of-scope Blob key')
        if (blob.key === identityKey(identity.usernameHash)) continue
        if ((await get(identityKey(identity.usernameHash)))?.userId !== identity.userId) {
          throw new Error('Account identity changed during deletion')
        }
        await remove(blob.key)
        deletedObjects++
      }
      if ((await list(prefix)).some(blob => blob.key !== identityKey(identity.usernameHash))) {
        throw new Error('Deletion not yet converged')
      }
    }
    if ((await get(identityKey(identity.usernameHash)))?.userId !== identity.userId) {
      throw new Error('Account identity changed before finalization')
    }
    for (const blob of await list(root(identity.userId) + 'days/')) await remove(blob.key)
    await remove(root(identity.userId) + 'return.json')
    await set(retiredKey, { userId: identity.userId, completedAt: clock() })
    await remove(identityKey(identity.usernameHash))
    if (await get(identityKey(identity.usernameHash)) !== null) throw new Error('Identity deletion not confirmed')
    // Minimal ID/hash tombstones deny late requests without retaining login
    // secrets, usernames or learning content. Username reuse has a 24h cooldown.
    return { ...base, action: 'deleted', deletedObjects: deletedObjects + 1 }
  }

  async function run({ dryRun = true, cursor = '', limit = 10, budgetMs = 35000 } = {}) {
    if (!configured) throw new AppError(503, 'idle_cleanup_unconfigured', 'Idle policy/admin binding is not configured')
    if (!dryRun && !execute) throw new AppError(403, 'idle_cleanup_disabled', 'Destructive maintenance is disabled')
    if (typeof cursor !== 'string' || (cursor && !HASH.test(cursor)) ||
        !Number.isInteger(limit) || limit < 1 || limit > 20 ||
        !Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 40000) {
      throw new AppError(400, 'invalid_cleanup_page', 'Invalid maintenance page')
    }
    const previousDeadline = deadline
    deadline = Math.min(deadline, clock() + budgetMs)
    try {
      const keys = (await list('accounts/')).filter(blob =>
        /^accounts\/[a-f0-9]{64}\/identity\.json$/.test(blob.key))
        .map(blob => blob.key.split('/')[1]).sort().filter(hash => hash > cursor)
      const selected = keys.slice(0, limit)
      const results = []
      let lastCompleted = cursor
      let paused = false
      for (const hash of selected) {
        try {
          const identity = await get(identityKey(hash))
          if (identity) {
            if (identity.usernameHash !== hash) throw new Error('Identity/key mismatch')
            results.push(await processAccount(identity, dryRun))
          }
          lastCompleted = hash
        } catch (error) {
          if (error instanceof BudgetExceeded) { paused = true; break }
          results.push({ action: 'error' })
          lastCompleted = hash
        }
      }
      return { dryRun, executionEnabled: execute, results, paused,
        nextCursor: paused || keys.length > selected.length ? lastCompleted : null }
    } finally { deadline = previousDeadline }
  }

  async function runDaily({ budgetMs = 35000 } = {}) {
    if (!configured || !execute) return { status: 'disabled' }
    const startedAt = clock()
    const day = new Date(startedAt).toISOString().slice(0, 10)
    const dailyKey = `maintenance/idle-runs/v1/${day}.json`
    if (await get(dailyKey) !== null) return { status: 'already_ran' }
    const owner = crypto.randomUUID()
    // Blob does not supply a distributed atomic lock. Verify this claim, then
    // use idempotent deletion fences for any rare cross-region overlap.
    await set(dailyKey, { owner, startedAt, status: 'running' })
    await new Promise(resolve => setTimeout(resolve, 25))
    if ((await get(dailyKey))?.owner !== owner) return { status: 'already_ran' }
    const progressKey = 'maintenance/idle-progress/v1.json'
    const previous = await get(progressKey)
    let cursor = typeof previous?.cursor === 'string' ? previous.cursor : ''
    const counts = {}
    let status = 'complete'
    try {
      do {
        const remaining = budgetMs - (clock() - startedAt)
        if (remaining <= 0) { status = 'paused'; break }
        const page = await run({ dryRun: false, cursor, limit: 20, budgetMs: remaining })
        for (const result of page.results) counts[result.action] = (counts[result.action] || 0) + 1
        cursor = page.nextCursor ?? ''
        await set(progressKey, { cursor, updatedAt: clock() })
        if (page.paused) { status = 'paused'; break }
        if (page.nextCursor === null) break
      } while (clock() - startedAt < budgetMs)
    } catch {
      status = 'interrupted'
      // The last per-page checkpoint survives. Repeating an interrupted page
      // is safe; individual account identities are always finalized last.
    }
    if (status === 'complete' && cursor) status = 'paused'
    if ((await get(dailyKey))?.owner === owner) {
      await set(dailyKey, { owner, startedAt, status, finishedAt: clock(), counts })
    }
    return { status, counts }
  }

  return { touch, beforeRegister, requireAdmin, inspect, usage, run, runDaily, configured }
}
