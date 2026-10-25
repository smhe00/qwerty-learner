/* eslint-env node */
import { randomUUID } from 'node:crypto'
import { BeforeMutationError, HandoffError } from './session-handoff-barrier.js'

// Qualification implementation, not a lease or a Blob read/overwrite lock.
// Each invocation owns distinct immutable keys (intent, ticket, entered, done).
// Requires complete globally strong listings + strong exact-key reads. A
// writer publishes its intent BEFORE choosing a ticket. An entrant waits for
// all visible choosers and every smaller (ticket,id). A later invisible entrant
// must see this entrant's already-published ticket and choose a larger one.
// Terminal receipts NEVER expire, IDs NEVER reuse, no TTL takeover or deletion.
// This is a bounded, single-use Bakery-style protocol; see the qualification
// report for assumptions, interleaving model, and remaining production limits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[a-f0-9]{64}$/
const kinds = ['writer', 'handoff']
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const equivalent = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function createBlobHandoffBarrier({ store, namespace = 'qualification-v1',
  maxOperations = 128, admissionTimeoutMs = 12_000, pollMs = 80,
  clock = () => performance.now(), sleep = pause, newId = randomUUID } = {}) {
  if (!store || !['get', 'list', 'setJSON'].every(name => typeof store[name] === 'function') ||
      !/^[a-z0-9-]{3,64}$/.test(namespace) || !Number.isSafeInteger(maxOperations) ||
      maxOperations < 2 || maxOperations > 512 ||
      !Number.isFinite(admissionTimeoutMs) || admissionTimeoutMs < 0 ||
      !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new HandoffError('handoff_invalid_configuration')
  }
  const root = hash => {
    if (!HASH.test(hash || '')) throw new HandoffError('handoff_invalid_principal')
    return `handoff/${namespace}/${hash}/`
  }
  const get = key => store.get(key, { type: 'json', consistency: 'strong' })
  async function put(key, value) {
    // Never use onlyIfNew as a CAS. An ID has one server-side owner. A lost
    // acknowledgment cannot authorize business work. Reads may recover an
    // identical immutable write, never a different candidate or an empty read.
    let failure
    try { await store.setJSON(key, value) } catch (error) { failure = error }
    const actual = await get(key)
    if (!equivalent(actual, value)) {
      throw new HandoffError('handoff_write_unverified', failure)
    }
  }
  const key = (hash, stage, id) => root(hash) + `op/${id}/${stage}.json`
  async function observe(hash) {
    const prefix = root(hash) + 'op/'
    // Membership AND phase evidence come from ONE complete strong page. Phase
    // is encoded in immutable key names, avoiding N remote reads per poll.
    const page = await store.list({ prefix, consistency: 'strong', paginate: false })
    if (!page || !Array.isArray(page.blobs) || page.cursor || page.hasMore ||
        page.nextCursor || page.truncated || page.blobs.length > maxOperations * 6) {
      throw new HandoffError('handoff_listing_incomplete')
    }
    const seen = new Set(), grouped = new Map()
    for (const item of page.blobs) {
      if (typeof item?.key !== 'string' || !item.key.startsWith(prefix) || seen.has(item.key)) {
        throw new HandoffError('handoff_listing_invalid')
      }
      seen.add(item.key)
      const parts = item.key.slice(prefix.length).split('/')
      const [id, file] = parts
      if (parts.length !== 2 || !UUID.test(id)) throw new HandoffError('handoff_listing_invalid')
      const row = grouped.get(id) || { id, kind: null, number: 0, done: null, entered: false, held: false }
      if (file === 'intent-writer.json' || file === 'intent-handoff.json') {
        if (row.kind) throw new HandoffError('handoff_evidence_invalid')
        row.kind = file === 'intent-writer.json' ? 'writer' : 'handoff'
      } else if (/^ticket-[1-9][0-9]*\.json$/.test(file)) {
        const number = Number(file.slice(7, -5))
        if (row.number || !Number.isSafeInteger(number)) throw new HandoffError('handoff_evidence_invalid')
        row.number = number
      } else if (file === 'done-done.json' || file === 'done-cancelled.json') {
        if (row.done) throw new HandoffError('handoff_evidence_invalid')
        row.done = { status: file === 'done-done.json' ? 'done' : 'cancelled' }
      } else if (file === 'entered.json') row.entered = true
      else if (file === 'held.json') row.held = true
      else throw new HandoffError('handoff_listing_invalid')
      grouped.set(id, row)
    }
    if (grouped.size > maxOperations) throw new HandoffError('handoff_listing_incomplete')
    for (const row of grouped.values()) {
      // A cancelled receipt can precede a delayed intent/ticket. It is inert,
      // never deleted and never interpreted as an active or reusable ID.
      if (!row.done && (!row.kind || (row.entered && !row.number) || (row.held && !row.entered))) {
        throw new HandoffError('handoff_evidence_invalid')
      }
    }
    return [...grouped.values()].sort((a, b) => a.id < b.id ? -1 : 1)
  }
  return Object.freeze({
    async status(hash) {
      const rows = await observe(hash)
      const active = rows.filter(row => !row.done)
      return { protocol: 'blob-bakery-fixtures-v1', operations: rows.length,
        capacity: maxOperations, pendingHandoffs: active.filter(row => row.kind === 'handoff').length,
        activeWriters: active.filter(row => row.kind === 'writer' && row.entered).length,
        heldWriters: active.filter(row => row.kind === 'writer' && row.held).length,
        unresolved: active.length }
    },
    async execute(hash, kind, operation) {
      if (!kinds.includes(kind) || typeof operation !== 'function') {
        throw new HandoffError('handoff_invalid_operation')
      }
      const id = newId()
      if (!UUID.test(id || '')) throw new HandoffError('handoff_invalid_operation')
      const start = clock()
      let started = false
      let registered = false
      try {
        const before = await observe(hash)
        if (before.length >= maxOperations) throw new HandoffError('handoff_capacity_reached')
        // Never publish a second contender under a reused ID.
        if (before.some(row => row.id === id)) {
          throw new HandoffError('handoff_operation_reused')
        }
        registered = true // even a rejected write may become durable later
        await put(key(hash, 'intent-' + kind, id), { version: 1, id, kind })
        const choosing = await observe(hash)
        if (!choosing.some(row => row.id === id)) throw new HandoffError('handoff_listing_incomplete')
        if (kind === 'writer' && choosing.some(row => row.kind === 'handoff' && !row.done)) {
          throw new HandoffError('handoff_draining')
        }
        const number = 1 + Math.max(0, ...choosing.map(row => row.number))
        if (!Number.isSafeInteger(number)) throw new HandoffError('handoff_capacity_reached')
        await put(key(hash, 'ticket-' + number, id), { id, number })
        for (;;) {
          const current = await observe(hash)
          if (!current.some(row => row.id === id) ||
              choosing.some(row => !current.some(value => value.id === row.id))) {
            throw new HandoffError('handoff_listing_incomplete')
          }
          const active = current.filter(row => row.id !== id && !row.done)
          if (kind === 'writer' && active.some(row => row.kind === 'handoff')) {
            throw new HandoffError('handoff_draining')
          }
          const blocked = active.some(row => row.number === 0 || row.number < number ||
            (row.number === number && row.id < id))
          if (!blocked) break
          if (clock() - start >= admissionTimeoutMs) throw new HandoffError('handoff_timeout')
          await sleep(pollMs)
        }
        await put(key(hash, 'entered', id), { id })
        started = true
        const output = await operation(Object.freeze({
          // Authenticated fixture-only deterministic fault injection. This
          // marker is diagnostic; neither it nor a delay grants ownership.
          markHeld: () => put(key(hash, 'held', id), { id }),
        }))
        await put(key(hash, 'done-done', id), { id, status: 'done' })
        return output
      } catch (error) {
        // No finally-unlock. Unknown in-flight mutations retain a durable
        // nonterminal participant, which prevents a later handoff entering.
        if (registered && (!started || error instanceof BeforeMutationError)) {
          try { await put(key(hash, 'done-cancelled', id), { id, status: 'cancelled' }) }
          catch { throw new HandoffError('handoff_cancel_unconfirmed') }
        }
        if (error instanceof BeforeMutationError) throw error.cause
        throw error
      }
    },
  })
}
