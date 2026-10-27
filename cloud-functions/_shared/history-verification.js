/* eslint-env node */
import crypto from 'node:crypto'

const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
const HASH = /^[a-f0-9]{64}$/
export const HISTORY_PAGE_READS = 8
// Existing discovery bounds: four devices, each with at most 128 batches.
const MAX_RECEIPTS = 512
const flags = { publishReady: false, convergenceComplete: false, listingIsAuthoritative: false }

/** Disposable server-owned, content-addressed evidence. No client-supplied
 * progress/count/digest is trusted. A checkpoint never authorizes a V4 write. */
export async function verifyHistoryPage({ accountId, heads, cursor, storage, read, assertOwner }) {
  const headKey = sha(canonical(heads))
  let state = { version: 1, accountId, headKey, heads, pending: heads.map(head => ({ ...head })), receipts: [], attempts: [] }
  const fail = reason => ({ ...flags, verified: false, reason,
    receiptsRead: state.receipts.length, totalReceipts: heads.reduce((n, h) => n + h.sequence, 0) })
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string' || !HASH.test(cursor)) return fail('verification-checkpoint-invalid')
    const saved = await storage.getHistoryVerification(accountId, cursor)
    await assertOwner()
    if (!saved) return fail('verification-checkpoint-missing')
    if (sha(canonical(saved)) !== cursor || saved.version !== 1 || saved.accountId !== accountId || !Array.isArray(saved.heads) || sha(canonical(saved.heads)) !== saved.headKey ||
        !Array.isArray(saved.pending) || !Array.isArray(saved.receipts) || !Array.isArray(saved.attempts) ||
        saved.receipts.length > MAX_RECEIPTS || saved.attempts.length > MAX_RECEIPTS * 32) {
      return fail('verification-checkpoint-invalid')
    }
    state = saved
    if (state.headKey !== headKey) {
      // Only append-only extensions may reuse evidence. New links are verified
      // down to an exact prior receipt; a fork at any old sequence still blocks.
      const changed = []
      for (const old of state.heads) {
        const current = heads.find(h => h.deviceId === old.deviceId)
        if (!current || current.sequence < old.sequence || (current.sequence === old.sequence &&
            (current.batchId !== old.batchId || current.sha256 !== old.sha256))) return fail('verification-checkpoint-invalid')
      }
      for (const current of heads) {
        const old = state.heads.find(h => h.deviceId === current.deviceId)
        if (!old || current.sequence > old.sequence) changed.push(current)
      }
      state = { ...state, headKey, heads, pending: [...changed, ...state.pending] }
    }
  }
  const attempts = new Map(state.attempts)
  const receipts = new Map(state.receipts)
  let reads = 0
  while (state.pending.length && reads < HISTORY_PAGE_READS) {
    const current = state.pending[0]
    const key = current.deviceId + ':' + current.sequence
    const expected = current.batchId + ':' + current.sha256
    if (receipts.has(key)) {
      if (receipts.get(key) !== expected) return fail('verification-device-fork')
      state.pending.shift()
      continue
    }
    if (receipts.size >= MAX_RECEIPTS) return fail('verification-budget-exceeded')
    const batch = await read(current)
    if (!batch) return fail('gap-or-stale-read')
    reads++
    for (const event of batch.events) {
      const digest = sha(canonical(event))
      if (attempts.has(event.attemptId) && attempts.get(event.attemptId) !== digest) return fail('verification-attempt-conflict')
      attempts.set(event.attemptId, digest)
    }
    receipts.set(key, expected)
    state.pending.shift()
    if (batch.sequence > 1) state.pending.unshift({ deviceId: batch.deviceId, sequence: batch.sequence - 1, ...batch.previous })
  }
  state.receipts = [...receipts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  state.attempts = [...attempts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const next = sha(canonical(state))
  await assertOwner()
  // Exact readback required. Lost cache acknowledgments cannot be treated as
  // confirmed progress or cause authoritative learning writes to be replayed.
  await storage.putHistoryVerification(accountId, next, state)
  const saved = await storage.getHistoryVerification(accountId, next)
  await assertOwner()
  if (!saved || sha(canonical(saved)) !== next) return fail('verification-checkpoint-unconfirmed')
  return { ...flags, verified: state.pending.length === 0,
    reason: state.pending.length ? 'verification-in-progress' : 'witnessed-heads-verified',
    cursor: next, receiptsRead: receipts.size, totalReceipts: heads.reduce((n, h) => n + h.sequence, 0),
    ...(state.pending.length ? {} : { uniqueAttemptCount: attempts.size,
      digestAlgorithm: 'attempt-sha256-v1', evidenceSha256: sha(canonical(state.attempts)) }) }
}
