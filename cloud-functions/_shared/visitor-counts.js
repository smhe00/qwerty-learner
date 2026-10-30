/* eslint-env node */
import { createHash } from 'node:crypto'

const PREFIX = 'metrics/visitors/v1/'
const DAY = 86400000
const localDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
const empty = headers => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...headers } })

/** One opaque cookie, no account/device/learning identity. An idempotent daily
 * marker avoids a shared read-modify-write counter on eventually consistent Blob. */
export async function recordVisitor(request, storeFactory, { clock = Date.now } = {}) {
  try {
    const site = request.headers.get('sec-fetch-site')
    const origin = request.headers.get('origin')
    if (request.method !== 'POST' || Number(request.headers.get('content-length') || 0) !== 0 ||
        (site ? site !== 'same-origin' : origin !== new URL(request.url).origin)) return empty()
    const id = request.headers.get('cookie')?.match(/(?:^|;\s*)qp_uv=([a-f0-9]{32})(?=;|$)/)?.[1]
    if (!id) return empty()
    const day = localDay(clock())
    const digest = createHash('sha256').update(day + ':' + id).digest('hex')
    try {
      await storeFactory().setJSON(`${PREFIX}${day}/${digest}.json`, { v: 1 })
    } catch { /* Analytics failure is intentionally invisible and never retried here. */ }
    return empty()
  } catch { return empty() }
}

/** Deduplicate within each Beijing calendar day, then SUM seven daily counts.
 * Reads only this metrics namespace; no learning rows or account lookup. */
export async function readVisitorCounts(store, { clock = Date.now } = {}) {
  const now = clock()
  let today = 0, last7Days = 0, pages = 0
  for (let i = 0; i < 7; i++) {
    const prefix = PREFIX + localDay(now - i * DAY) + '/'
    let cursor = ''
    const seen = new Set()
    do {
      if (++pages > 128 || clock() - now > 10000) throw Error('Visitor statistics scan limit')
      const page = await store.list({ prefix, cursor: cursor || undefined, limit: 1000, paginate: false, consistency: 'strong' })
      if (!Array.isArray(page?.blobs) || page.blobs.length > 1000) throw Error('Visitor statistics unavailable')
      for (const item of page.blobs) {
        if (typeof item.key !== 'string' || !item.key.startsWith(prefix) || !/^[a-f0-9]{64}\.json$/.test(item.key.slice(prefix.length)))
          throw Error('Visitor statistics namespace mismatch')
        const id = item.key.slice(prefix.length, -5)
        seen.add(id)
      }
      if (page.cursor && page.cursor === cursor) throw Error('Visitor statistics cursor stalled')
      cursor = page.cursor || ''
    } while (cursor)
    if (i === 0) today = seen.size
    last7Days += seen.size
  }
  return { today, last7Days, asOf: new Date(now).toISOString(), timeZone: 'Asia/Shanghai' }
}
