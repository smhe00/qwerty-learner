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

  function revisionPrefix(userId) {
    return `users/${userId}/revisions/`
  }

  function revisionKey(userId, revision) {
    return `${revisionPrefix(userId)}${String(revision).padStart(12, '0')}.json`
  }

  function parseVersion(key) {
    const match = /\/(\d{12})\.json$/.exec(key)
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
      if (!latest || version > latest.version) latest = { version, key: blob.key }
    }

    if (!latest) return null
    const value = await strongJson(latest.key)
    return value === null ? null : { version: latest.version, value }
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

    async createRevision(userId, revision, snapshot) {
      return setJsonOnlyIfNew(revisionKey(userId, revision), snapshot)
    },

    async getLatestRevision(userId) {
      const latest = await latestObject(revisionPrefix(userId))
      return latest ? { revision: latest.version, snapshot: latest.value } : null
    },

    async deleteUserData(usernameHash, userId) {
      const [authDeleted, revisionsDeleted] = await Promise.all([
        deletePrefix(authPrefix(usernameHash)),
        deletePrefix(revisionPrefix(userId)),
      ])
      const account = await strongJson(accountKey(usernameHash))
      if (account !== null) await store.delete(accountKey(usernameHash))
      return { accountDeleted: account !== null, authDeleted, revisionsDeleted }
    },
  }
}
