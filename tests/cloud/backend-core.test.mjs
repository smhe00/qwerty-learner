import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackendService } from '../../backend/core.mjs'
import { runBackendSelfTest } from '../../backend/self-test.mjs'

class MemoryStorage {
  constructor() {
    this.accounts = new Map()
    this.auth = new Map()
    this.revisions = new Map()
  }

  async createAccount(hash, identity) {
    if (this.accounts.has(hash)) return false
    this.accounts.set(hash, structuredClone(identity))
    return true
  }

  async getAccount(hash) {
    const value = this.accounts.get(hash)
    return value ? structuredClone(value) : null
  }

  async createAuthVersion(hash, version, record) {
    const key = `${hash}:${version}`
    if (this.auth.has(key)) return false
    this.auth.set(key, structuredClone(record))
    return true
  }

  async getLatestAuth(hash) {
    let latest = null
    for (const [key, value] of this.auth.entries()) {
      if (!key.startsWith(`${hash}:`)) continue
      const version = Number(key.slice(hash.length + 1))
      if (!latest || version > latest.version) latest = { version, value }
    }
    return latest ? structuredClone(latest.value) : null
  }

  async createRevision(userId, revision, snapshot) {
    const key = `${userId}:${revision}`
    if (this.revisions.has(key)) return false
    this.revisions.set(key, structuredClone(snapshot))
    return true
  }

  async getLatestRevision(userId) {
    let latest = null
    for (const [key, snapshot] of this.revisions.entries()) {
      if (!key.startsWith(`${userId}:`)) continue
      const revision = Number(key.slice(userId.length + 1))
      if (!latest || revision > latest.revision) latest = { revision, snapshot }
    }
    return latest ? structuredClone(latest) : null
  }

  async deleteUserData(usernameHash, userId) {
    const accountDeleted = this.accounts.delete(usernameHash)
    let authDeleted = 0
    let revisionsDeleted = 0

    for (const key of [...this.auth.keys()]) {
      if (key.startsWith(`${usernameHash}:`)) {
        this.auth.delete(key)
        authDeleted += 1
      }
    }

    for (const key of [...this.revisions.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.revisions.delete(key)
        revisionsDeleted += 1
      }
    }

    return { accountDeleted, authDeleted, revisionsDeleted }
  }
}

test('cloud backend full contract', async () => {
  const service = createBackendService({
    storage: new MemoryStorage(),
    sessionSecret: 'test-session-secret-0123456789abcdef0123456789abcdef',
    maxSyncBytes: 4 * 1024 * 1024,
  })

  const report = await runBackendSelfTest(service)
  assert.equal(report.success, true)
  assert.ok(report.steps.every((step) => step.ok))
})
