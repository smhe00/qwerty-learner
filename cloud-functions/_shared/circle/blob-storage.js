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

  return Object.freeze({ read, create })
}
