/* eslint-env node */
import crypto from 'node:crypto'

// Keep each Blob value comfortably below the verified Maker JSON write range.
// This changes only internal Blob representation, never the public V4 API.
const INLINE_PAYLOAD_CHARS = 192 * 1024
const PART_CHARS = 192 * 1024 // Must be divisible by four (Base64 quartets).
const MAX_PARTS = 64

const RETRY_DELAYS_MS = [0, 100, 250, 500]

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

async function withRetry(operation) {
  let lastError

  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs)

    try {
      return await operation()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function jsonEquivalent(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

export function createEdgeOneBlobStorage(store) {
  const strongJson = (key) =>
    withRetry(() => store.get(key, { type: 'json', consistency: 'strong' }))

  const strongList = (prefix) =>
    withRetry(() => store.list({ prefix, consistency: 'strong' }))

  const deleteKey = (key) => withRetry(() => store.delete(key))

  const setJson = (key, value) => withRetry(() => store.setJSON(key, value))

  function accountKey(usernameHash) {
    return `accounts/${usernameHash}/identity.json`
  }

  function authPrefix(usernameHash) {
    return `accounts/${usernameHash}/auth/`
  }

  function authKey(usernameHash, version) {
    return `${authPrefix(usernameHash)}${String(version).padStart(12, '0')}.json`
  }

  function sessionPrefix(usernameHash) {
    return `accounts/${usernameHash}/sessions/`
  }

  function sessionKey(usernameHash, version) {
    return `${sessionPrefix(usernameHash)}${String(version).padStart(12, '0')}.json`
  }

  function independentSessionPrefix(usernameHash) {
    return `accounts/${usernameHash}/independent-sessions/`
  }

  function independentSessionKey(usernameHash, tokenHash) {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('Invalid session hash')
    return `${independentSessionPrefix(usernameHash)}active/${tokenHash}.json`
  }

  function revocationKey(usernameHash, tokenHash) {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('Invalid session hash')
    return `${independentSessionPrefix(usernameHash)}revoked/${tokenHash}.json`
  }

  function eventBatchPrefix(userId) {
    return `users/${userId}/event-batches/v1/`
  }

  function eventBatchKey(userId, deviceId, batchId, sha256) {
    if (!/^qwerty-web-[a-f0-9-]{36}$/i.test(deviceId) ||
        !/^[a-f0-9-]{36}$/i.test(batchId) ||
        !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid event-batch key')
    }
    // The SHA suffix separates conflicting requests that reuse a batch ID.
    // Both survive; a later discovery/replay stage MUST detect that anomaly.
    return `${eventBatchPrefix(userId)}${deviceId}/${batchId}-${sha256}.json`
  }

  function revisionPrefix(userId) {
    return `users/${userId}/revisions/`
  }

  function revisionKey(userId, revision) {
    return `${revisionPrefix(userId)}${String(revision).padStart(12, '0')}.json`
  }

  function revisionPartsPrefix(userId, revision = null) {
    return `users/${userId}/revision-parts/` +
      (revision === null ? '' : `${String(revision).padStart(12, '0')}/`)
  }

  function partKey(userId, revision, sha, index) {
    return revisionPartsPrefix(userId, revision) + sha + '/' +
      String(index).padStart(4, '0') + '.json'
  }

  async function readManifestParts(userId, revision, manifest) {
    const layout = manifest?.chunkedPayload
    if (!layout) return manifest
    if (layout.version !== 1 ||
        !/^[a-f0-9]{64}$/.test(layout.sha256 || '') ||
        layout.sha256 !== manifest.dataSha256 ||
        !Number.isSafeInteger(layout.count) || layout.count < 1 || layout.count > MAX_PARTS ||
        !Number.isSafeInteger(layout.encodedLength) || layout.encodedLength < 4 ||
        layout.encodedLength > layout.count * PART_CHARS) {
      throw new Error('V4 revision manifest is invalid; refusing incomplete restore')
    }
    const parts = await Promise.all(Array.from({ length: layout.count }, (_, index) =>
      strongJson(partKey(userId, revision, layout.sha256, index))))
    if (parts.some((part, index) =>
      !part || part.version !== 1 || part.index !== index ||
      typeof part.data !== 'string' || part.data.length > PART_CHARS ||
      !/^[a-zA-Z0-9+/]*={0,2}$/.test(part.data))) {
      throw new Error('V4 revision has missing or invalid Blob chunks; refusing restore')
    }
    const encoded = parts.map(part => part.data).join('')
    if (encoded.length !== layout.encodedLength ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
        encoded.length % 4 !== 0) {
      throw new Error('V4 revision chunk length or Base64 integrity failed')
    }
    const bytes = Buffer.from(encoded, 'base64')
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    if (sha !== layout.sha256 || bytes.length !== manifest.sizeBytes) {
      throw new Error('V4 revision chunk SHA-256 or byte count mismatch')
    }
    return { ...manifest, payloadBase64: encoded }
  }

  function authRateLimitPrefix(clientKey) {
    return `rate-limit/auth/${clientKey}/windows/`
  }

  function authRateLimitCounterKey(clientKey, windowStart) {
    return `${authRateLimitPrefix(clientKey)}${windowStart}.json`
  }

  function parseVersion(key) {
    const match = /\/(\d{12})\.json$/.exec(key)
    return match ? Number(match[1]) : null
  }

  function parseRateLimitCounterWindow(key) {
    const match = /\/windows\/(\d+)\.json$/.exec(key)
    return match ? Number(match[1]) : null
  }

  async function setJsonOnlyIfNew(key, value) {
    let lastError

    for (const delayMs of RETRY_DELAYS_MS) {
      if (delayMs > 0) await sleep(delayMs)

      try {
        await store.setJSON(key, value, { onlyIfNew: true })
        return true
      } catch (error) {
        lastError = error
      }

      try {
        const existing = await strongJson(key)

        if (existing !== null) {
          // A write can become durable even when the client observes a transport
          // error. If the strong read returns exactly our candidate, recover that
          // ambiguous success. A different durable object is a genuine conflict.
          return jsonEquivalent(existing, value)
        }
      } catch (readError) {
        lastError = readError
      }
    }

    throw lastError
  }

  async function latestObject(prefix) {
    const { blobs = [] } = await strongList(prefix)
    let latest = null

    for (const blob of blobs) {
      const version = parseVersion(blob.key)
      if (version === null) continue
      if (!latest || version > latest.version) {
        latest = { version, key: blob.key }
      }
    }

    if (!latest) return null

    const value = await strongJson(latest.key)
    return value === null ? null : { version: latest.version, value }
  }

  async function listVersioned(prefix) {
    const { blobs = [] } = await strongList(prefix)

    return blobs
      .map((blob) => ({
        key: blob.key,
        version: parseVersion(blob.key),
      }))
      .filter((item) => item.version !== null)
      .sort((left, right) => left.version - right.version)
  }

  async function pruneVersioned(prefix, keepCount) {
    if (!Number.isInteger(keepCount) || keepCount < 1) {
      throw new Error('keepCount must be a positive integer')
    }

    const versions = await listVersioned(prefix)
    const obsolete = versions.slice(0, Math.max(0, versions.length - keepCount))

    await Promise.all(obsolete.map((item) => deleteKey(item.key)))

    return {
      deleted: obsolete.length,
      retained: versions.length - obsolete.length,
      latestVersion: versions.length ? versions[versions.length - 1].version : 0,
    }
  }

  async function deletePrefix(prefix) {
    const { blobs = [] } = await strongList(prefix)
    await Promise.all(blobs.map((blob) => deleteKey(blob.key)))
    return blobs.length
  }

  return {
    async createAccount(usernameHash, identity) {
      const key = accountKey(usernameHash)
      const existing = await strongJson(key)
      if (existing !== null) return false

      return setJsonOnlyIfNew(key, identity)
    },

    async getAccount(usernameHash) {
      return strongJson(accountKey(usernameHash))
    },

    async createAuthVersion(usernameHash, version, record) {
      return setJsonOnlyIfNew(authKey(usernameHash, version), record)
    },

    async getLatestAuth(usernameHash) {
      const latest = await latestObject(authPrefix(usernameHash))
      return latest ? latest.value : null
    },

    async pruneAuthVersions(usernameHash, keepCount) {
      return pruneVersioned(authPrefix(usernameHash), keepCount)
    },

    async createSessionVersion(usernameHash, version, record) {
      return setJsonOnlyIfNew(sessionKey(usernameHash, version), record)
    },

    async getLatestSession(usernameHash) {
      const latest = await latestObject(sessionPrefix(usernameHash))
      return latest ? latest.value : null
    },

    async pruneSessionVersions(usernameHash, keepCount) {
      return pruneVersioned(sessionPrefix(usernameHash), keepCount)
    },

    async createIndependentSession(usernameHash, tokenHash, record) {
      if (record?.tokenHash !== tokenHash) throw new Error('Session hash mismatch')
      return setJsonOnlyIfNew(independentSessionKey(usernameHash, tokenHash), record)
    },

    async getIndependentSession(usernameHash, tokenHash) {
      return strongJson(independentSessionKey(usernameHash, tokenHash))
    },

    async getSessionRevocation(usernameHash, tokenHash) {
      return strongJson(revocationKey(usernameHash, tokenHash))
    },

    async revokeSessionToken(usernameHash, tokenHash) {
      // Every writer writes identical monotonic evidence to this unique key.
      // No in-place active-session rewrite, read-modify-write, or CAS is needed.
      return setJsonOnlyIfNew(revocationKey(usernameHash, tokenHash), { revoked: true })
    },

    async putImmutableEventBatch(userId, deviceId, batchId, sha256, record) {
      const key = eventBatchKey(userId, deviceId, batchId, sha256)
      // No shared revision key or CAS. A same-content retry is identical.
      return setJsonOnlyIfNew(key, record)
    },

    async getImmutableEventBatch(userId, deviceId, batchId, sha256) {
      return strongJson(eventBatchKey(userId, deviceId, batchId, sha256))
    },

    async observeImmutableEventBatches(userId) {
      // Strong list on one POP is still not a globally complete event history.
      const prefix = eventBatchPrefix(userId)
      const page = await strongList(prefix)
      if (!page || !Array.isArray(page.blobs) || page.blobs.length > 512) {
        throw new Error('Bounded event observation unavailable')
      }
      const pattern = /^qwerty-web-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{64})\.json$/i
      const receipts = page.blobs.map(item => {
        if (!item || typeof item.key !== 'string' ||
            !item.key.startsWith(prefix)) throw new Error('Malformed event key')
        const hit = pattern.exec(item.key.slice(prefix.length))
        if (!hit) throw new Error('Unrecognized event key')
        return { deviceId: 'qwerty-web-' + hit[1],
          batchId: hit[2], sha256: hit[3] }
      })
      receipts.sort((a, b) =>
        (a.deviceId + a.batchId + a.sha256).localeCompare(
          b.deviceId + b.batchId + b.sha256))
      return {
        receipts,
        truncated: Boolean(page.cursor || page.hasMore ||
          page.truncated || page.nextCursor),
      }
    },

    async createRevision(userId, revision, snapshot) {
      const encoded = snapshot?.payloadBase64
      if (snapshot?.clientFormatVersion !== 'qwerty-backup-v4' ||
          typeof encoded !== 'string' || encoded.length <= INLINE_PAYLOAD_CHARS) {
        return setJsonOnlyIfNew(revisionKey(userId, revision), snapshot)
      }
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
        throw new Error('Invalid V4 transport Base64; revision not committed')
      }
      const parts = []
      for (let offset = 0; offset < encoded.length; offset += PART_CHARS) {
        parts.push(encoded.slice(offset, offset + PART_CHARS))
      }
      if (parts.length > MAX_PARTS) {
        throw new Error('V4 snapshot too large for bounded revision chunks')
      }
      const checksum = crypto.createHash('sha256')
        .update(Buffer.from(encoded, 'base64')).digest('hex')
      if (checksum !== snapshot.dataSha256) {
        throw new Error('V4 snapshot transport checksum mismatch; revision not committed')
      }
      // Immutable part objects are written *before* a compact revision manifest.
      // A partial write only leaves unreferenced parts, never a visible revision.
      // Existing Blob onlyIfNew semantics remain best-effort, not atomic CAS.
      for (let offset = 0; offset < parts.length; offset += 4) {
        await Promise.all(parts.slice(offset, offset + 4).map((data, j) =>
          setJsonOnlyIfNew(partKey(userId, revision, checksum, offset + j), {
            version: 1, index: offset + j, data,
          }).then(created => {
            if (!created) throw new Error('Conflicting V4 immutable Blob chunk')
          })))
      }
      const manifest = {
        ...snapshot, payloadBase64: null,
        chunkedPayload: { version: 1, sha256: checksum,
          count: parts.length, encodedLength: encoded.length },
      }
      return setJsonOnlyIfNew(revisionKey(userId, revision), manifest)
    },

    async getLatestRevisionMeta(userId) {
      const latest = await latestObject(revisionPrefix(userId))
      return latest ? { revision: latest.version, snapshot: latest.value } : null
    },

    async getLatestRevision(userId) {
      const latest = await latestObject(revisionPrefix(userId))
      return latest ? {
        revision: latest.version,
        snapshot: await readManifestParts(userId, latest.version, latest.value),
      } : null
    },

    async pruneRevisions(userId, keepCount) {
      if (!Number.isInteger(keepCount) || keepCount < 1) {
        throw new Error('keepCount must be a positive integer')
      }
      const versions = await listVersioned(revisionPrefix(userId))
      const obsolete = versions.slice(0, Math.max(0, versions.length - keepCount))
      await Promise.all(obsolete.map(async revision => {
        await deleteKey(revision.key)
        await deletePrefix(revisionPartsPrefix(userId, revision.version))
      }))
      return { deleted: obsolete.length, retained: versions.length - obsolete.length,
        latestRevision: versions.length ? versions[versions.length - 1].version : 0 }
    },

    async getAuthRateLimitCounter(clientKey, windowStart) {
      return strongJson(authRateLimitCounterKey(clientKey, windowStart))
    },

    async setAuthRateLimitCounter(clientKey, windowStart, record) {
      await setJson(authRateLimitCounterKey(clientKey, windowStart), record)
    },

    async pruneAuthRateLimitCounters(clientKey, minWindowStart) {
      const prefix = authRateLimitPrefix(clientKey)
      const { blobs = [] } = await strongList(prefix)
      const obsolete = blobs.filter((blob) => {
        const windowStart = parseRateLimitCounterWindow(blob.key)
        return windowStart !== null && windowStart < minWindowStart
      })

      await Promise.all(obsolete.map((blob) => deleteKey(blob.key)))

      return {
        deleted: obsolete.length,
      }
    },

    async deleteUserData(usernameHash, userId) {
      const [authDeleted, sessionsDeleted, independentSessionsDeleted,
        revisionsDeleted, revisionPartsDeleted, eventBatchesDeleted] = await Promise.all([
        deletePrefix(authPrefix(usernameHash)),
        deletePrefix(sessionPrefix(usernameHash)),
        deletePrefix(independentSessionPrefix(usernameHash)),
        deletePrefix(revisionPrefix(userId)),
        deletePrefix(revisionPartsPrefix(userId)),
        deletePrefix(eventBatchPrefix(userId)),
      ])

      const account = await strongJson(accountKey(usernameHash))
      if (account !== null) {
        await deleteKey(accountKey(usernameHash))
      }

      return {
        accountDeleted: account !== null,
        authDeleted,
        sessionsDeleted: sessionsDeleted + independentSessionsDeleted,
        independentSessionsDeleted,
        revisionsDeleted,
        revisionPartsDeleted,
        eventBatchesDeleted,
      }
    },
  }
}
