/* eslint-env node */
export function createEdgeOneBlobStorage(store) {
  const strongJson = (key) => store.get(key, { type: 'json', consistency: 'strong' })

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

  function revisionPrefix(userId) {
    return `users/${userId}/revisions/`
  }

  function revisionKey(userId, revision) {
    return `${revisionPrefix(userId)}${String(revision).padStart(12, '0')}.json`
  }

  function authRateLimitPrefix(clientKey) {
    return `rate-limit/auth/${clientKey}/windows/`
  }

  function authRateLimitWindowPrefix(clientKey, windowStart) {
    return `${authRateLimitPrefix(clientKey)}${windowStart}/`
  }

  function authRateLimitSlotKey(clientKey, windowStart, slot) {
    return `${authRateLimitWindowPrefix(clientKey, windowStart)}slot-${String(slot).padStart(3, '0')}.json`
  }

  function parseVersion(key) {
    const match = /\/(\d{12})\.json$/.exec(key)
    return match ? Number(match[1]) : null
  }

  function parseRateLimitSlot(key) {
    const match = /\/slot-(\d+)\.json$/.exec(key)
    return match ? Number(match[1]) : null
  }

  function parseRateLimitWindow(key) {
    const match = /\/windows\/(\d+)\//.exec(key)
    return match ? Number(match[1]) : null
  }

  async function setJsonOnlyIfNew(key, value) {
    try {
      await store.setJSON(key, value, { onlyIfNew: true })
      return true
    } catch (error) {
      const existing = await strongJson(key)
      if (existing !== null) return false
      throw error
    }
  }

  async function latestObject(prefix) {
    const { blobs = [] } = await store.list({ prefix, consistency: 'strong' })
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
    const { blobs = [] } = await store.list({ prefix, consistency: 'strong' })

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

    await Promise.all(obsolete.map((item) => store.delete(item.key)))

    return {
      deleted: obsolete.length,
      retained: versions.length - obsolete.length,
      latestVersion: versions.length ? versions[versions.length - 1].version : 0,
    }
  }

  async function deletePrefix(prefix) {
    const { blobs = [] } = await store.list({ prefix, consistency: 'strong' })
    await Promise.all(blobs.map((blob) => store.delete(blob.key)))
    return blobs.length
  }

  return {
    async createAccount(usernameHash, identity) {
      return setJsonOnlyIfNew(accountKey(usernameHash), identity)
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

    async createRevision(userId, revision, snapshot) {
      return setJsonOnlyIfNew(revisionKey(userId, revision), snapshot)
    },

    async getLatestRevision(userId) {
      const latest = await latestObject(revisionPrefix(userId))
      return latest ? { revision: latest.version, snapshot: latest.value } : null
    },

    async pruneRevisions(userId, keepCount) {
      const result = await pruneVersioned(revisionPrefix(userId), keepCount)
      return {
        deleted: result.deleted,
        retained: result.retained,
        latestRevision: result.latestVersion,
      }
    },

    async listAuthRateLimitSlots(clientKey, windowStart) {
      const { blobs = [] } = await store.list({
        prefix: authRateLimitWindowPrefix(clientKey, windowStart),
        consistency: 'strong',
      })

      return blobs
        .map((blob) => parseRateLimitSlot(blob.key))
        .filter((slot) => slot !== null)
        .sort((left, right) => left - right)
    },

    async claimAuthRateLimitSlot(clientKey, windowStart, slot, record) {
      return setJsonOnlyIfNew(
        authRateLimitSlotKey(clientKey, windowStart, slot),
        record,
      )
    },

    async pruneAuthRateLimitWindows(clientKey, minWindowStart) {
      const prefix = authRateLimitPrefix(clientKey)
      const { blobs = [] } = await store.list({ prefix, consistency: 'strong' })
      const obsolete = blobs.filter((blob) => {
        const windowStart = parseRateLimitWindow(blob.key)
        return windowStart !== null && windowStart < minWindowStart
      })

      await Promise.all(obsolete.map((blob) => store.delete(blob.key)))

      return {
        deleted: obsolete.length,
      }
    },

    async deleteUserData(usernameHash, userId) {
      const [authDeleted, sessionsDeleted, revisionsDeleted] = await Promise.all([
        deletePrefix(authPrefix(usernameHash)),
        deletePrefix(sessionPrefix(usernameHash)),
        deletePrefix(revisionPrefix(userId)),
      ])

      const account = await strongJson(accountKey(usernameHash))
      if (account !== null) {
        await store.delete(accountKey(usernameHash))
      }

      return {
        accountDeleted: account !== null,
        authDeleted,
        sessionsDeleted,
        revisionsDeleted,
      }
    },
  }
}
