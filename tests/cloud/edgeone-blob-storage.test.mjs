/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const clone = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)))

class FakeBlobStore {
  constructor() {
    this.objects = new Map()
    this.getFailures = 0
    this.listFailures = 0
    this.deleteFailures = 0
    this.setFailures = 0
    this.ambiguousOnlyIfNewWrite = false
  }

  async get(key) {
    if (this.getFailures > 0) {
      this.getFailures -= 1
      throw new Error('transient get failure')
    }

    return this.objects.has(key) ? clone(this.objects.get(key)) : null
  }

  async list({ prefix }) {
    if (this.listFailures > 0) {
      this.listFailures -= 1
      throw new Error('transient list failure')
    }

    return {
      blobs: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    }
  }

  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) {
      throw new Error('already exists')
    }

    if (this.setFailures > 0) {
      this.setFailures -= 1
      throw new Error('transient set failure')
    }

    this.objects.set(key, clone(value))

    if (options.onlyIfNew && this.ambiguousOnlyIfNewWrite) {
      this.ambiguousOnlyIfNewWrite = false
      throw new Error('response lost after durable write')
    }
  }

  async delete(key) {
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1
      throw new Error('transient delete failure')
    }

    this.objects.delete(key)
  }
}

test('Blob adapter retries transient strong reads', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'a'.repeat(64)
  const identity = { userId: 'u1', status: 'active' }

  store.objects.set(`accounts/${hash}/identity.json`, identity)
  store.getFailures = 2

  assert.deepEqual(await storage.getAccount(hash), identity)
  assert.equal(store.getFailures, 0)
})

test('Blob adapter retries transient list operations for latest session lookup', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'b'.repeat(64)

  assert.equal(
    await storage.createSessionVersion(hash, 2, { version: 2, tokenHash: 'x' }),
    true,
  )

  store.listFailures = 2

  assert.deepEqual(await storage.getLatestSession(hash), {
    version: 2,
    tokenHash: 'x',
  })
  assert.equal(store.listFailures, 0)
})

test('Blob adapter recovers onlyIfNew ambiguous durable success', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'c'.repeat(64)
  const identity = {
    userId: 'u-ambiguous',
    status: 'active',
    nested: { z: 1, a: 2 },
  }

  store.ambiguousOnlyIfNewWrite = true

  assert.equal(await storage.createAccount(hash, identity), true)
  assert.deepEqual(await storage.getAccount(hash), identity)
})

test('Blob adapter still distinguishes a genuine onlyIfNew conflict', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'd'.repeat(64)

  assert.equal(
    await storage.createAccount(hash, { userId: 'winner', status: 'active' }),
    true,
  )

  assert.equal(
    await storage.createAccount(hash, { userId: 'loser', status: 'active' }),
    false,
  )
})

test('Blob adapter retries transient delete operations during cleanup', async () => {
  const store = new FakeBlobStore()
  const storage = createEdgeOneBlobStorage(store)
  const hash = 'e'.repeat(64)
  const userId = 'cleanup-user'

  await storage.createAccount(hash, { userId, status: 'active' })
  await storage.createSessionVersion(hash, 2, { version: 2 })
  await storage.createRevision(userId, 1, { revision: 1 })

  store.deleteFailures = 2

  const result = await storage.deleteUserData(hash, userId)

  assert.equal(result.accountDeleted, true)
  assert.equal(result.sessionsDeleted, 1)
  assert.equal(result.revisionsDeleted, 1)
  assert.equal(store.deleteFailures, 0)
})
