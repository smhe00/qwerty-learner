/* eslint-env node */
import crypto from 'node:crypto'

// Keep each Blob value comfortably below the verified Maker JSON write range.
// This changes only internal Blob representation, never the public V4 API.
const INLINE_PAYLOAD_CHARS = 192 * 1024
const PART_CHARS = 192 * 1024 // Must be divisible by four (Base64 quartets).
const MAX_PARTS = 64

const RETRY_DELAYS_MS = [0, 100, 250, 500]

/** Structured, non-credential stage information for real Maker failures. */
export class SnapshotBlobStageError extends Error {
  constructor(stage, cause, index = null) {
    super('V4 Blob ' + stage + ' failed' +
      (index === null ? '' : ' at part ' + index) +
      ': ' + (cause instanceof Error ? cause.message : String(cause)))
    this.name = 'SnapshotBlobStageError'
    this.stage = stage
    this.partIndex = index
    this.cause = cause
  }
}


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
  const strongBinary = async (key) => {
    const value = await withRetry(() =>
      store.get(key, { type: 'arrayBuffer', consistency: 'strong' }))
    return value === null ? null : Buffer.from(value)
  }

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


  function chainedBatchPrefix(userId) {
    return `users/${userId}/event-batches/v2/`
  }

  function chainedBatchKey(userId, deviceId, sequence, batchId, sha256) {
    if (!/^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId) ||
        !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 1_000_000_000 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId) ||
        !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid chained batch storage selector')
    }
    return `${chainedBatchPrefix(userId)}${deviceId}/${String(sequence).padStart(10, '0')}/${batchId}-${sha256}.json`
  }

  function uploadPrefix(userId, payloadSha256 = null) {
    if (payloadSha256 !== null && !/^[a-f0-9]{64}$/.test(payloadSha256)) {
      throw new Error('Invalid V4 upload SHA')
    }
    return 'users/' + userId + '/v4-http-parts/v1/' +
      (payloadSha256 === null ? '' : payloadSha256 + '/')
  }

  function binaryUploadKey(userId, payloadSha256, count, index, partSha256) {
    if (!/^[a-f0-9]{64}$/.test(payloadSha256) ||
        !/^[a-f0-9]{64}$/.test(partSha256) ||
        !Number.isSafeInteger(count) || count < 1 || count > 192 ||
        !Number.isSafeInteger(index) || index < 0 || index >= count) {
      throw new Error('Invalid binary V4 upload selector')
    }
    return `users/${userId}/v4-http-parts/v3/${payloadSha256}/${count}/${String(index).padStart(3, '0')}-${partSha256}.bin`
  }

  function uploadKey(userId, payloadSha256, index, partSha256) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 191 ||
        !/^[a-f0-9]{64}$/.test(partSha256)) {
      throw new Error('Invalid V4 upload part selector')
    }
    return uploadPrefix(userId, payloadSha256) +
      String(index).padStart(3, '0') + '-' + partSha256 + '.json'
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
  function binaryRevisionKey(userId, revision, sha, index) {
    return revisionPartsPrefix(userId, revision) + sha + '/' +
      String(index).padStart(4, '0') + '.bin'
  }

  async function readManifestParts(userId, revision, manifest) {
    const layout = manifest?.chunkedPayload
    if (!layout) return manifest
    if (layout.version === 3) {
      const chunkBytes = 512 * 1024
      if (layout.chunkBytes !== chunkBytes)
        throw new Error('Binary revision chunk size evidence invalid')
      if (!/^[a-f0-9]{64}$/.test(layout.sha256 || '') ||
          layout.sha256 !== manifest.dataSha256 ||
          !Number.isSafeInteger(layout.count) || layout.count < 1 ||
          layout.count > MAX_PARTS ||
          !Number.isSafeInteger(layout.byteLength) || layout.byteLength < 1 ||
          layout.byteLength !== manifest.sizeBytes ||
          !Array.isArray(layout.partSha256s) ||
          layout.partSha256s.length !== layout.count ||
          !layout.partSha256s.every(sha => /^[a-f0-9]{64}$/.test(sha))) {
        throw new Error('Binary revision manifest invalid')
      }
      const parts = await Promise.all(Array.from({ length: layout.count }, (_, index) =>
        strongBinary(binaryRevisionKey(userId, revision, layout.sha256, index))))
      if (parts.some((p, i) => !p ||
          p.length < 1 || p.length > chunkBytes ||
          (i !== layout.count - 1 && p.length !== chunkBytes) ||
          crypto.createHash('sha256').update(p).digest('hex') !== layout.partSha256s[i])) {
        throw new Error('Binary revision part failed integrity verification')
      }
      const bytes = Buffer.concat(parts)
      if (bytes.length !== layout.byteLength ||
          crypto.createHash('sha256').update(bytes).digest('hex') !== layout.sha256) {
        throw new Error('Binary revision full SHA/byte length mismatch')
      }
      return { ...manifest, payloadBytes: bytes }
    }
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

  async function setBinaryOnlyIfNew(key, bytes) {
    // Contents are immutable, yet Blob onlyIfNew is NOT an atomic CAS.
    // Recover ambiguous acknowledgments by comparing exact bytes after a
    // strong read. Never accept a conflicting object as our own.
    let lastError
    const expected = Buffer.from(bytes)
    for (const delayMs of RETRY_DELAYS_MS) {
      if (delayMs > 0) await sleep(delayMs)
      try {
        const body = expected.buffer.slice(expected.byteOffset,
          expected.byteOffset + expected.byteLength)
        await store.set(key, body, { onlyIfNew: true })
        const observed = await strongBinary(key)
        if (observed !== null && observed.equals(expected)) return true
        throw new Error('Binary Blob write not verified')
      } catch (error) {
        lastError = error
      }
      try {
        const existing = await strongBinary(key)
        if (existing !== null) return existing.equals(expected)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
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

  // One Maker request owns one storage adapter. Never persist trace in Blob.
  let lastV4RevisionTiming = null
  return {
    getLastV4RevisionTiming() {
      return lastV4RevisionTiming ? { ...lastV4RevisionTiming } : null
    },
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


    async putImmutableChainedBatch(userId, deviceId, sequence, batchId, sha256, record) {
      return setJsonOnlyIfNew(
        chainedBatchKey(userId, deviceId, sequence, batchId, sha256), record)
    },

    async getImmutableChainedBatch(userId, deviceId, sequence, batchId, sha256) {
      return strongJson(chainedBatchKey(userId, deviceId, sequence, batchId, sha256))
    },


    async observeImmutableChainedBatches(userId) {
      const prefix = chainedBatchPrefix(userId)
      const page = await strongList(prefix)
      if (!page || !Array.isArray(page.blobs) || page.blobs.length > 512) {
        throw new Error('Chained batch listing unavailable or exceeds bounded limit')
      }
      const pattern = /^(qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(\d{10})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([a-f0-9]{64})\.json$/i
      const receipts = page.blobs.map(item => {
        if (!item || typeof item.key !== 'string' ||
            !item.key.startsWith(prefix)) throw new Error('Invalid chained batch listing key')
        const match = pattern.exec(item.key.slice(prefix.length))
        if (!match) throw new Error('Unexpected chained batch listing key')
        const seq = Number(match[2])
        if (!Number.isSafeInteger(seq) || seq < 1 || seq > 1_000_000_000) {
          throw new Error('Invalid chained batch sequence')
        }
        return { deviceId: match[1], sequence: seq,
          batchId: match[3], sha256: match[4] }
      })
      receipts.sort((a, b) =>
        a.deviceId.localeCompare(b.deviceId) ||
        a.sequence - b.sequence ||
        (a.batchId + a.sha256).localeCompare(b.batchId + b.sha256))
      return {
        receipts,
        truncated: Boolean(page.cursor || page.hasMore ||
          page.nextCursor || page.truncated),
      }
    },

    async putV4UploadPart(userId, payloadSha256, index, partSha256, content) {
      if (content?.version === 3) {
        if (!Buffer.isBuffer(content.data)) throw new Error('Expected binary V4 part')
        return setBinaryOnlyIfNew(binaryUploadKey(userId, payloadSha256,
          content.count, index, partSha256), content.data)
      }
      if (content?.version !== 1) throw new Error('Unsupported V4 upload stage')
      return setJsonOnlyIfNew(uploadKey(userId, payloadSha256, index, partSha256),
        content)
    },

    async getV4UploadPart(userId, payloadSha256, index, partSha256, count,
      wirePartBytes) {
      if (Number.isSafeInteger(count) && count >= 1 && count <= 192) {
        const bytes = await strongBinary(binaryUploadKey(
          userId, payloadSha256, count, index, partSha256))
        if (bytes !== null) return {
          version: 3, index, count, payloadSha256, partSha256, data: bytes,
          ...(wirePartBytes === undefined ? {} : { wirePartBytes }),
        }
      }
      // Backward reading of original 32-KiB Base64 JSON stages is separate
      // from the retired 192-KiB binary staging format.
      return strongJson(uploadKey(userId, payloadSha256, index, partSha256))
    },

    async deleteV4UploadParts(userId, payloadSha256) {
      const old = await deletePrefix(uploadPrefix(userId, payloadSha256))
      const binary = await deletePrefix(`users/${userId}/v4-http-parts/v3/${payloadSha256}/`)
      return old + binary
    },

    async createRevision(userId, revision, snapshot) {
      lastV4RevisionTiming = null
      if (snapshot?.clientFormatVersion === 'qwerty-backup-v4' &&
          Buffer.isBuffer(snapshot.payloadBytes)) {
        const bytes = snapshot.payloadBytes
        const sha = crypto.createHash('sha256').update(bytes).digest('hex')
        if (bytes.length !== snapshot.sizeBytes || sha !== snapshot.dataSha256 ||
            !bytes.length || bytes.length > 4 * 1024 * 1024) {
          throw new Error('Invalid V4 binary revision evidence')
        }
        const chunkBytes = 512 * 1024
        const parts = Array.from({ length: Math.ceil(bytes.length / chunkBytes) }, (_, i) =>
          bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes))
        if (parts.length > MAX_PARTS) throw new Error('Excessive binary V4 chunks')
        const partSha256s = parts.map(part =>
          crypto.createHash('sha256').update(part).digest('hex'))
        const timing = { revisionChunkCount: parts.length,
          revisionWriteMs: 0, revisionReadbackMs: 0, revisionManifestMs: 0 }
        lastV4RevisionTiming = timing
        const elapsed = start => Math.round((performance.now() - start) * 10) / 10
        for (let i = 0; i < parts.length; i++) {
          const key = binaryRevisionKey(userId, revision, sha, i)
          try {
            const started = performance.now()
            try {
              if (!await setBinaryOnlyIfNew(key, parts[i])) {
                throw new Error('Immutable binary revision evidence conflicts')
              }
            } finally {
              timing.revisionWriteMs += elapsed(started)
            }
            const readStart = performance.now()
            try {
              const observed = await strongBinary(key)
              if (!observed || !observed.equals(parts[i])) {
                throw new Error('Binary revision chunk readback mismatch')
              }
            } finally {
              timing.revisionReadbackMs += elapsed(readStart)
            }
          } catch (error) {
            throw new SnapshotBlobStageError('chunk_precommit', error, i)
          }
        }
        const fields = { ...snapshot }
        delete fields.payloadBytes
        const manifest = { ...fields, payloadEncoding: 'binary',
          chunkedPayload: { version: 3, chunkBytes, sha256: sha,
            count: parts.length, byteLength: bytes.length, partSha256s } }
        const started = performance.now()
        try {
          return await setJsonOnlyIfNew(revisionKey(userId, revision), manifest)
        } catch (error) {
          throw new SnapshotBlobStageError('manifest_commit', error)
        } finally {
          timing.revisionManifestMs = elapsed(started)
          timing.revisionWriteMs = Math.round(timing.revisionWriteMs * 10) / 10
          timing.revisionReadbackMs = Math.round(timing.revisionReadbackMs * 10) / 10
        }
      }
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
      const revisionTiming = {
        revisionChunkCount: parts.length,
        revisionWriteMs: 0, revisionReadbackMs: 0, revisionManifestMs: 0,
      }
      lastV4RevisionTiming = revisionTiming
      const elapsed = start => Math.round((performance.now() - start) * 10) / 10
      // Immutable part objects are written *before* a compact revision manifest.
      // Sequential writes bound pressure on Makers Blob under large uploads;
      // each exact-key strong read verifies durable evidence before commit.
      // No shared CAS/atomic-onlyIfNew behavior is assumed.
      for (let index = 0; index < parts.length; index++) {
        const key = partKey(userId, revision, checksum, index)
        const candidate = { version: 1, index, data: parts[index] }
        try {
          const writeStart = performance.now()
          try {
            const stored = await setJsonOnlyIfNew(key, candidate)
            if (!stored) throw new Error('immutable part key already has other evidence')
          } finally {
            revisionTiming.revisionWriteMs += elapsed(writeStart)
          }
          const readStart = performance.now()
          try {
            const observed = await strongJson(key)
            if (!jsonEquivalent(observed, candidate)) {
              throw new Error('immutable part not verified after write')
            }
          } finally {
            revisionTiming.revisionReadbackMs += elapsed(readStart)
          }
        } catch (error) {
          throw new SnapshotBlobStageError('chunk_precommit', error, index)
        }
      }
      const manifest = {
        ...snapshot, payloadBase64: null,
        chunkedPayload: { version: 1, sha256: checksum,
          count: parts.length, encodedLength: encoded.length },
      }
      const manifestStart = performance.now()
      try {
        return await setJsonOnlyIfNew(revisionKey(userId, revision), manifest)
      } catch (error) {
        throw new SnapshotBlobStageError('manifest_commit', error)
      } finally {
        revisionTiming.revisionManifestMs = elapsed(manifestStart)
        for (const key of ['revisionWriteMs', 'revisionReadbackMs']) {
          revisionTiming[key] = Math.round(revisionTiming[key] * 10) / 10
        }
      }
    },

    async getBinaryRevisionPart(userId, revision, sha, index) {
      if (!Number.isSafeInteger(revision) || revision < 1 ||
          !/^[a-f0-9]{64}$/.test(sha) ||
          !Number.isSafeInteger(index) || index < 0 || index >= MAX_PARTS) {
        throw new Error('Invalid binary revision selector')
      }
      const manifest = await strongJson(revisionKey(userId, revision))
      const layout = manifest?.chunkedPayload
      if (!layout || layout.version !== 3 || layout.sha256 !== sha ||
          manifest.revision !== revision || index >= layout.count ||
          !Array.isArray(layout.partSha256s)) return null
      const chunkBytes = 512 * 1024
      if (layout.chunkBytes !== chunkBytes)
        throw new Error('Binary revision chunk size evidence invalid')
      const bytes = await strongBinary(binaryRevisionKey(userId, revision, sha, index))
      if (!bytes || !bytes.length || bytes.length > chunkBytes ||
          (index !== layout.count - 1 && bytes.length !== chunkBytes) ||
          crypto.createHash('sha256').update(bytes).digest('hex') !==
            layout.partSha256s[index]) {
        throw new Error('Binary revision chunk missing or corrupt')
      }
      return { bytes, manifest }
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
        revisionsDeleted, revisionPartsDeleted, eventBatchesDeleted,
        chainedEventBatchesDeleted, pendingV4PartsDeleted,
        pendingBinaryV4PartsDeleted] = await Promise.all([
        deletePrefix(authPrefix(usernameHash)),
        deletePrefix(sessionPrefix(usernameHash)),
        deletePrefix(independentSessionPrefix(usernameHash)),
        deletePrefix(revisionPrefix(userId)),
        deletePrefix(revisionPartsPrefix(userId)),
        deletePrefix(eventBatchPrefix(userId)),
        deletePrefix(chainedBatchPrefix(userId)),
        deletePrefix(uploadPrefix(userId)),
        deletePrefix(`users/${userId}/v4-http-parts/v3/`),
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
        eventBatchesDeleted: eventBatchesDeleted + chainedEventBatchesDeleted,
        chainedEventBatchesDeleted,
        pendingV4PartsDeleted: pendingV4PartsDeleted + pendingBinaryV4PartsDeleted,
      }
    },
  }
}
