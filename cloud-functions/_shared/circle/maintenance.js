/* eslint-env node */
import { calendarDay, createCircleV3Storage, isActivityKey, isSummaryKey, windowDays } from './bounded-storage.js'

const ROOT = 'social/v3/circles/'
const CIRCLE_PREFIX = /^social\/v3\/circles\/([a-f0-9]{24})\/$/
const PARTITION_PARENT = /^social\/v3\/circles\/([a-f0-9]{24})\/(days|summaries)\/$/
const PARTITION = /^social\/v3\/circles\/([a-f0-9]{24})\/(days|summaries)\/(\d{4}-\d{2}-\d{2})\/$/
function partitionOf(key) {
  const match = /^(social\/v3\/circles\/[a-f0-9]{24}\/(?:days|summaries)\/\d{4}-\d{2}-\d{2}\/)/.exec(key)
  if (!match) throw new Error('Invalid maintenance key')
  return PARTITION.exec(match[1])
}
function validPrefix(prefix) { return prefix === ROOT || PARTITION_PARENT.test(prefix) || PARTITION.test(prefix) }

/** Bounded, restartable operator sweep; no user session or active-circle request required.
 * Directory pages are enumerated before deleting below them. Expired partitions
 * are drained from their first page after each delete batch, never continuing an
 * offset cursor invalidated by our own deletes. Dry runs may safely use cursors.
 * Checkpoints contain only scoped keys/cursors, never credentials or record contents.
 * Concurrent additions require a later full sweep; completion is not erasure proof.
 */
export async function sweepCircleV3(blob, {
  now = Date.now(), execute = false, checkpoint, maxPages = 20, maxDeletes = 200,
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isInteger(maxDeletes) || maxDeletes < 1 || maxDeletes > 1000) throw new TypeError('Invalid sweep budget')
  const storage = createCircleV3Storage(blob)
  const oldest = windowDays(now)[6]
  const tasks = checkpoint ? structuredClone(checkpoint.tasks) : [{ kind: 'list', prefix: ROOT }]
  if (checkpoint && (checkpoint.schemaVersion !== 3 || checkpoint.execute !== execute ||
      typeof checkpoint.oldest !== 'string' || !calendarDay(checkpoint.oldest) ||
      checkpoint.oldest > oldest)) throw new Error('Incompatible sweep checkpoint')
  if (!Array.isArray(tasks) || tasks.length > 20000) throw new Error('Invalid sweep checkpoint')
  function validate(task) {
    if (task?.kind === 'delete') {
      if (!isActivityKey(task.key) && !isSummaryKey(task.key)) throw new Error('Out-of-scope deletion')
      const day = partitionOf(task.key)[3]
      if (!calendarDay(day) || day >= oldest) throw new Error('Live partition deletion denied')
    } else if (task?.kind === 'list') {
      if (!validPrefix(task.prefix) || (task.cursor !== undefined && typeof task.cursor !== 'string') ||
          !Array.isArray(task.seen || []) || (task.seen?.length || 0) > 100) throw new Error('Invalid listing checkpoint')
      const part = PARTITION.exec(task.prefix)
      if (part && (!calendarDay(part[3]) || part[3] >= oldest || (execute && task.cursor))) {
        throw new Error('Invalid partition checkpoint')
      }
    } else throw new Error('Invalid maintenance task')
  }
  tasks.forEach(validate)
  const stats = { pages: 0, candidates: 0, deleted: 0, oldestDay: oldest, execute }
  while (tasks.length && stats.pages < maxPages && stats.candidates < maxDeletes) {
    if (tasks.length > 20000) throw new Error('Maintenance queue budget exceeded')
    const task = tasks.shift()
    validate(task)
    if (task.kind === 'delete') {
      stats.candidates++
      if (execute) { await storage.remove(task.key); stats.deleted++ }
      continue
    }
    const match = PARTITION.exec(task.prefix)
    const page = await blob.list({ prefix: task.prefix, directories: !match,
      paginate: false, consistency: 'strong', ...(task.cursor ? { cursor: task.cursor } : {}) })
    stats.pages++
    if (!page || !Array.isArray(page.blobs) || page.blobs.length > 10000 ||
        page.nextCursor || page.hasMore || page.truncated ||
        !Array.isArray(page.directories || []) || (page.directories?.length || 0) > 10000) {
      throw new Error('Uncertain maintenance listing')
    }
    const next = page.cursor || undefined
    if (next && (typeof next !== 'string' || (task.seen || []).includes(next))) throw new Error('Repeated maintenance cursor')
    if ((task.seen?.length || 0) >= 100) throw new Error('Maintenance page budget exceeded')
    if (match) {
      if ((page.directories?.length || 0) > 0 || (!page.blobs.length && next)) throw new Error('Invalid partition listing')
      const deletions = page.blobs.map(({ key }) => {
        if (typeof key !== 'string' || !key.startsWith(task.prefix) ||
            !(match[2] === 'days' ? isActivityKey(key) : isSummaryKey(key))) throw new Error('Out-of-scope maintenance object')
        return { kind: 'delete', key }
      })
      const continuation = next ? [{ kind: 'list', prefix: task.prefix,
        ...(!execute ? { cursor: next, seen: [...(task.seen || []), next] } : {}) }] : []
      // Finish deletions before repeating first page. This also supports very large
      // expired partitions without keeping a full inventory in memory/checkpoints.
      tasks.unshift(...deletions, ...continuation)
    } else {
      if (page.blobs.length) throw new Error('Unexpected objects at partition root')
      const children = []
      for (const prefix of page.directories || []) {
        if (typeof prefix !== 'string' || !prefix.startsWith(task.prefix)) throw new Error('Out-of-scope maintenance directory')
        if (task.prefix === ROOT) {
          if (!CIRCLE_PREFIX.test(prefix)) throw new Error('Invalid circle directory')
          children.push({ kind: 'list', prefix: prefix + 'days/' }, { kind: 'list', prefix: prefix + 'summaries/' })
        } else {
          const part = PARTITION.exec(prefix)
          if (!part || !calendarDay(part[3])) throw new Error('Invalid date partition')
          if (part[3] < oldest) children.push({ kind: 'list', prefix })
        }
      }
      if (next) tasks.unshift({ kind: 'list', prefix: task.prefix, cursor: next, seen: [...(task.seen || []), next] })
      tasks.push(...children)
    }
  }
  return { ...stats, complete: !tasks.length,
    checkpoint: tasks.length ? { schemaVersion: 3, execute, oldest, tasks } : null }
}
