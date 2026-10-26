/* eslint-env node */
import { AppError } from '../core.js'
import { canonical } from './event-log.js'

export const USER = /^[A-Za-z0-9_-]{8,128}$/
export const CIRCLE = /^[a-f0-9]{24}$/
export const DAY = /^\d{4}-\d{2}-\d{2}$/
export const fail = (status, code) => { throw new AppError(status, code, code) }
export const root = (id) => {
  if (!CIRCLE.test(id || '')) throw new TypeError('Invalid circle ID')
  return 'social/v3/circles/' + id + '/'
}
export function calendarDay(day) {
  return typeof day === 'string' && DAY.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) &&
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day
}
export function windowDays(now = Date.now()) {
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
  const midnight = Date.parse(today + 'T00:00:00Z')
  return Array.from({ length: 7 }, (_, n) => new Date(midnight - n * 86400000).toISOString().slice(0, 10))
}
const id = '[a-f0-9]{24}'
const uid = '[A-Za-z0-9_-]{8,128}'
const day = '\\d{4}-\\d{2}-\\d{2}'
const base = 'social/v3/circles/' + id + '/'
const controlKey = new RegExp('^(?:' + base + '(?:meta|closed|members/' + uid +
  ')\\.json|social/v3/accounts/' + uid + '/circles/' + id + '\\.json)$')
const activityKey = new RegExp('^' + base + 'days/' + day + '/' + uid + '/[a-f0-9]{64}\\.json$')
const summaryKey = new RegExp('^' + base + 'summaries/' + day + '/view\\.json$')
const validPrefix = new RegExp('^(?:' + base + '(?:members/|days/' + day +
  '/|summaries/' + day + '/)|social/v3/accounts/' + uid + '/circles/)$')
export const isActivityKey = (key) => activityKey.test(key)
export const isSummaryKey = (key) => summaryKey.test(key)

export async function mapBounded(items, fn, concurrency = 8) {
  const result = new Array(items.length)
  let next = 0
  let failure
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && next < items.length) {
      const i = next++
      try { result[i] = await fn(items[i], i) } catch (error) { failure = error }
    }
  }))
  if (failure) throw failure
  return result
}

/** Private store facade. Control reads are strong; activity/summary reads are eventual.
 * Readback confirms the observed value, not transactional or concurrent admission.
 */
export function createCircleV3Storage(blob) {
  if (['get', 'setJSON', 'delete', 'list'].some((key) => typeof blob?.[key] !== 'function')) {
    throw new TypeError('Circle v3 requires private Blob get/setJSON/delete/list')
  }
  const check = (key) => {
    if (typeof key !== 'string' || !(controlKey.test(key) || activityKey.test(key) || summaryKey.test(key))) {
      throw new TypeError('Circle v3 key out of scope')
    }
  }
  const get = async (key) => {
    check(key)
    return blob.get(key, { type: 'json', consistency: controlKey.test(key) ? 'strong' : 'eventual' })
  }
  async function hold(actor) {
    if (!USER.test(actor || '')) throw new TypeError('Verified Circle actor required')
    await blob.setJSON('social/v2/accounts/' + actor + '/used.json', { used: true })
  }
  return Object.freeze({
    get,
    async put(key, value, actor) {
      check(key)
      if (Buffer.byteLength(canonical(value)) > (summaryKey.test(key) ? 2097152 : 8192)) {
        fail(503, 'circle_record_too_large')
      }
      try {
        // Summary caching creates no new personal facts; all source writers already held.
        if (!summaryKey.test(key)) await hold(actor)
        await blob.setJSON(key, value)
        if (controlKey.test(key) && canonical(await get(key)) !== canonical(value)) {
          fail(503, 'circle_write_unknown')
        }
      } catch { fail(503, 'circle_write_unknown') }
    },
    async remove(key, actor) {
      check(key)
      // Metadata and closure are durable; no public operation may remove them.
      if (/\/(?:meta|closed)\.json$/.test(key)) throw new TypeError('Durable Circle control record')
      try {
        if (controlKey.test(key)) await hold(actor)
        await blob.delete(key)
        if (controlKey.test(key) && await get(key) !== null) fail(503, 'circle_write_unknown')
      } catch { fail(503, 'circle_write_unknown') }
    },
    async keys(prefix, { maxKeys = 10000 } = {}) {
      if (!validPrefix.test(prefix)) throw new TypeError('Circle v3 prefix out of scope')
      const consistency = /\/(?:members|circles)\/$/.test(prefix) ? 'strong' : 'eventual'
      const keys = new Set()
      const seen = new Set()
      let cursor
      do {
        const page = await blob.list({ prefix, paginate: false, consistency, ...(cursor ? { cursor } : {}) })
        if (!page || !Array.isArray(page.blobs) || page.nextCursor || page.hasMore || page.truncated ||
            (page.directories?.length ?? 0) > 0) fail(503, 'circle_listing_uncertain')
        for (const item of page.blobs) {
          const key = item?.key
          check(key)
          if (!key.startsWith(prefix)) fail(503, 'circle_listing_uncertain')
          keys.add(key)
        }
        if (keys.size > maxKeys || seen.size >= 100) fail(503, 'circle_read_budget')
        cursor = page.cursor
        if (cursor !== undefined && cursor !== null && cursor !== '' &&
            (typeof cursor !== 'string' || seen.has(cursor))) fail(503, 'circle_listing_uncertain')
        if (cursor) seen.add(cursor)
      } while (cursor)
      return [...keys].sort()
    },
  })
}
