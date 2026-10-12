/* eslint-env node */
/**
 * QWERTY Circle independent Blob adapter. Never shares the V4 backup keyspace.
 * All authoritative records are immutable and require atomic onlyIfNew writes.
 */
const ROOT = 'social/v1/'
const RETRY_MS = [0, 30, 80, 180]

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item,
)

export function createCircleBlobStorage(blob) {
  if (!blob || typeof blob.get !== 'function' || typeof blob.setJSON !== 'function') {
    throw new TypeError('Circle requires a Blob store with get and setJSON')
  }

  async function read(relative) {
    const key = ROOT + relative
    let error
    for (const ms of RETRY_MS) {
      if (ms) await pause(ms)
      try {
        return await blob.get(key, { type: 'json', consistency: 'strong' })
      } catch (caught) { error = caught }
    }
    throw error
  }

  async function create(relative, value) {
    const key = ROOT + relative
    let error
    for (const ms of RETRY_MS) {
      if (ms) await pause(ms)
      try {
        await blob.setJSON(key, value, { onlyIfNew: true })
        return true
      } catch (caught) {
        error = caught
        // A lost HTTP response after a durable write is not a failed commit.
        // A different committed value is a true conflict and must not overwrite.
        const actual = await read(relative)
        if (actual !== null) return canonical(actual) === canonical(value)
      }
    }
    throw error
  }

  async function list(relativePrefix) {
    if (!blob.list) throw new TypeError('Circle Blob does not support list')
    let error
    for (const ms of RETRY_MS) {
      if (ms) await pause(ms)
      try {
        // The EdgeOne SDK aggregates all pages by default.
        const { blobs = [] } = await blob.list({
          prefix: ROOT + relativePrefix,
          consistency: 'strong',
        })
        return blobs.map(({ key }) => {
          if (!key.startsWith(ROOT + relativePrefix)) {
            throw new Error('Circle storage returned an out-of-scope key')
          }
          return key.slice(ROOT.length)
        })
      } catch (caught) { error = caught }
    }
    throw error
  }

  async function remove(relative) {
    if (typeof blob.delete !== 'function') {
      throw new TypeError('Circle Blob does not support delete')
    }
    // Removal is deliberately only available through this isolated adapter.
    // Callers MUST have committed a durable disable/closed tombstone first.
    const key = ROOT + relative
    let lastError
    for (const ms of RETRY_MS) {
      if (ms) await pause(ms)
      try {
        await blob.delete(key)
        if (await read(relative) === null) return true
      } catch (caught) { lastError = caught }
    }
    // Failed deletes are retried by trusted operators, never acknowledged as
    // successful. Tombstones remain and access continues to be blocked.
    throw lastError || new Error('Circle Blob delete did not become visible')
  }

  return Object.freeze({ read, create, list, remove })
}
