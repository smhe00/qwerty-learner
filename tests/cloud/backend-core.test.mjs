/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { runBackendSelfTest } from '../../cloud-functions/_shared/self-test.js'

const clone = (value) => JSON.parse(JSON.stringify(value))

class MemoryStorage {
  constructor() {
    this.accounts = new Map()
    this.auth = new Map()
    this.sessions = new Map()
    this.revisions = new Map()
  }

  async createAccount(hash, identity) {
    if (this.accounts.has(hash)) return false
    this.accounts.set(hash, clone(identity))
    return true
  }

  async getAccount(hash) {
    const value = this.accounts.get(hash)
    return value ? clone(value) : null
  }

  async createAuthVersion(hash, version, record) {
    const key = `${hash}:${version}`
    if (this.auth.has(key)) return false
    this.auth.set(key, clone(record))
    return true
  }

  async getLatestAuth(hash) {
    let latest = null

    for (const [key, value] of this.auth.entries()) {
      if (!key.startsWith(`${hash}:`)) continue
      const version = Number(key.slice(hash.length + 1))

      if (!latest || version > latest.version) {
        latest = { version, value }
      }
    }

    return latest ? clone(latest.value) : null
  }

  async createSessionVersion(hash, version, record) {
    const key = `${hash}:${version}`
    if (this.sessions.has(key)) return false
    this.sessions.set(key, clone(record))
    return true
  }

  async getLatestSession(hash) {
    let latest = null

    for (const [key, value] of this.sessions.entries()) {
      if (!key.startsWith(`${hash}:`)) continue
      const version = Number(key.slice(hash.length + 1))

      if (!latest || version > latest.version) {
        latest = { version, value }
      }
    }

    return latest ? clone(latest.value) : null
  }

  async createRevision(userId, revision, snapshot) {
    const key = `${userId}:${revision}`
    if (this.revisions.has(key)) return false
    this.revisions.set(key, clone(snapshot))
    return true
  }

  async getLatestRevision(userId) {
    let latest = null

    for (const [key, snapshot] of this.revisions.entries()) {
      if (!key.startsWith(`${userId}:`)) continue
      const revision = Number(key.slice(userId.length + 1))

      if (!latest || revision > latest.revision) {
        latest = { revision, snapshot }
      }
    }

    return latest ? clone(latest) : null
  }

  async pruneRevisions(userId, keepCount) {
    const entries = [...this.revisions.keys()]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => ({
        key,
        revision: Number(key.slice(userId.length + 1)),
      }))
      .sort((left, right) => left.revision - right.revision)

    const obsolete = entries.slice(0, Math.max(0, entries.length - keepCount))

    for (const item of obsolete) {
      this.revisions.delete(item.key)
    }

    return {
      deleted: obsolete.length,
      retained: entries.length - obsolete.length,
      latestRevision: entries.length ? entries[entries.length - 1].revision : 0,
    }
  }

  revisionVersions(userId) {
    return [...this.revisions.keys()]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => Number(key.slice(userId.length + 1)))
      .sort((a, b) => a - b)
  }

  async deleteUserData(usernameHash, userId) {
    const accountDeleted = this.accounts.delete(usernameHash)
    let authDeleted = 0
    let sessionsDeleted = 0
    let revisionsDeleted = 0

    for (const key of [...this.auth.keys()]) {
      if (key.startsWith(`${usernameHash}:`)) {
        this.auth.delete(key)
        authDeleted += 1
      }
    }

    for (const key of [...this.sessions.keys()]) {
      if (key.startsWith(`${usernameHash}:`)) {
        this.sessions.delete(key)
        sessionsDeleted += 1
      }
    }

    for (const key of [...this.revisions.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.revisions.delete(key)
        revisionsDeleted += 1
      }
    }

    return {
      accountDeleted,
      authDeleted,
      sessionsDeleted,
      revisionsDeleted,
    }
  }
}

test('cloud backend full contract', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({
    storage,
    maxSyncBytes: 4 * 1024 * 1024,
    snapshotRetention: 3,
  })

  const report = await runBackendSelfTest(service)

  assert.equal(report.success, true)
  assert.ok(report.steps.every((step) => step.ok))
  assert.equal(report.stepCount, report.steps.length)
  assert.equal(report.cleanup.accountDeleted, true)
  assert.ok(report.cleanup.sessionsDeleted >= 1)
})

test('snapshot retention keeps only the latest three full revisions', async () => {
  const storage = new MemoryStorage()
  const service = createBackendService({
    storage,
    snapshotRetention: 3,
  })

  const username = 'retention_test_user'
  const password = 'Retention-Test-Password-123'
  const registered = await service.register(username, password, 'retention-device')
  const userId = registered.user.userId

  let baseRevision = 0
  for (let revision = 1; revision <= 6; revision += 1) {
    const payloadBase64 = Buffer.from(
      JSON.stringify({ revision, value: `snapshot-${revision}` }),
      'utf8',
    ).toString('base64')

    const result = await service.putSync(registered.token, {
      baseRevision,
      payloadBase64,
      deviceId: 'retention-device',
      clientFormatVersion: 'test-v1',
    })

    assert.equal(result.revision, revision)
    baseRevision = revision
  }

  assert.deepEqual(storage.revisionVersions(userId), [4, 5, 6])

  const latest = await service.getSync(registered.token)
  assert.equal(latest.revision, 6)

  await service.cleanupTestUser(username)
})
