/* eslint-env node */
import { AppError } from './core.js'
import { createHash } from 'node:crypto'

const IDENTITY = /^accounts\/[a-f0-9]{64}\/identity\.json$/
const DAY = 86400000
/** Read-only, bounded operating view. Never downloads/decompresses backups or
 * returns learning content, auth records, tokens, password hashes or Blob keys.
 * Listing is eventually consistent; completeness is explicit, never an atomic census. */
export function createAdministratorOverview({ store, administrator, clock = Date.now }) {
  async function list(prefix, cursor = '', limit = 100) {
    const page = await store.list({ prefix, cursor: cursor || undefined, limit, paginate: false, consistency: 'strong' })
    if (
      !Array.isArray(page?.blobs) ||
      page.blobs.length > limit ||
      page.blobs.some((b) => typeof b.key !== 'string' || !b.key.startsWith(prefix))
    )
      throw new AppError(503, 'administrator_statistics_unavailable', '统计列表暂时无法完整读取')
    return { blobs: page.blobs, cursor: page.cursor || '' }
  }
  const read = (key) => store.get(key, { type: 'json', consistency: 'strong' })
  return {
    async read(actor, cursor = '') {
      if (!administrator.isAdministrator({ ...actor, normalizedUsername: actor.username?.toLowerCase(), status: 'active' }))
        throw new AppError(403, 'administrator_required', 'Administrator access required')
      if (typeof cursor !== 'string' || cursor.length > 2048) throw new AppError(400, 'invalid_cursor', '分页信息无效')
      // Five listed objects per scan bound per-user metadata and history I/O.
      // Auth/session keys are not read, even when returned by the prefix listing.
      let page,
        keys,
        scans = 0
      do {
        page = await list('accounts/', cursor, 5)
        keys = page.blobs.filter((b) => IDENTITY.test(b.key)).map((b) => b.key)
        if (page.cursor && page.cursor === cursor) throw new AppError(503, 'administrator_statistics_unavailable', '统计分页未前进')
        cursor = page.cursor
      } while (!keys.length && page.cursor && ++scans < 6)
      const rows = []
      for (const key of keys) {
        const identity = await read(key)
        if (
          !identity ||
          identity.status !== 'active' ||
          identity.usernameHash !== key.split('/')[1] ||
          typeof identity.username !== 'string' ||
          !/^[a-f0-9]{32}$/.test(identity.userId || '')
        )
          throw new AppError(503, 'administrator_statistics_changed', '账号列表已变化，请重新核对')
        if (administrator.isAdministrator(identity)) continue
        const row = {
          id: identity.userId,
          username: identity.username,
          createdAt: identity.createdAt,
          testAccount: /^(e2e_|v4_ga_)/i.test(identity.username || ''),
          activeDays: [],
          attempts: 0,
          recentAttempts: 0,
          historyComplete: false,
          metadataAvailable: true,
        }
        try {
          const days = Array.from({ length: 7 }, (_, i) => new Date(clock() - i * DAY).toISOString().slice(0, 10))
          const activity = await Promise.all(days.map((day) => read(`maintenance/idle/v1/${identity.userId}/days/${day}.json`)))
          row.activeDays = days.filter((day, i) => activity[i]?.day === day)
          const prefix = `users/${identity.userId}/event-batches/v2/`
          const history = await list(prefix, '', 12)
          const attempts = new Map()
          for (const item of history.blobs) {
            const batch = await read(item.key)
            if (!Array.isArray(batch?.events)) throw new Error('history missing')
            for (const event of batch.events) {
              if (typeof event.attemptId !== 'string' || !Number.isFinite(event.timeStamp)) throw new Error('invalid event')
              // The same immutable attempt can appear in several envelopes.
              // A conflicting identity makes this row unknown, not an inflated count.
              const fingerprint = createHash('sha256')
                .update(
                  JSON.stringify(
                    Object.fromEntries(
                      Object.keys(event)
                        .sort()
                        .map((k) => [k, event[k]]),
                    ),
                  ),
                )
                .digest('hex')
              const prior = attempts.get(event.attemptId)
              if (prior && prior.fingerprint !== fingerprint) throw new Error('conflicting attempt')
              attempts.set(event.attemptId, { timeStamp: event.timeStamp, fingerprint })
            }
          }
          row.attempts = attempts.size
          row.recentAttempts = [...attempts.values()].filter(
            ({ timeStamp: t }) => t * 1000 >= clock() - 7 * DAY && t * 1000 <= clock(),
          ).length
          row.historyComplete = !history.cursor
        } catch {
          row.metadataAvailable = false
          row.attempts = null
          row.recentAttempts = null
        }
        rows.push(row)
      }
      return {
        rows,
        nextCursor: page.cursor || null,
        asOf: new Date(clock()).toISOString(),
        basis: 'authenticated-cloud-activity-utc-and-uploaded-v2-attempts',
        eventualConsistency: true,
      }
    },
  }
}
