/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const clone = (x) => (x === null ? null : JSON.parse(JSON.stringify(x)))

class FakeBlob {
  constructor() { this.objects = new Map() }
  async get(key) { return this.objects.has(key) ? clone(this.objects.get(key)) : null }
  async list({ prefix }) {
    return { blobs: [...this.objects.keys()].filter(key => key.startsWith(prefix))
      .map(key => ({ key })) }
  }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.objects.has(key)) throw new Error('already exists')
    this.objects.set(key, clone(value))
  }
  async delete(key) { this.objects.delete(key) }
}

test('default mode retains single-active-session authentication', async () => {
  const storage = createEdgeOneBlobStorage(new FakeBlob())
  const service = createBackendService({ storage })
  const first = await service.register('single_mode_user', 'Password-A123', 'device-A')
  const second = await service.login('single_mode_user', 'Password-A123', 'device-B')
  await assert.rejects(service.me(first.token), error => error.code === 'session_revoked')
  assert.equal((await service.me(second.token)).session.deviceId, 'device-B')
  await assert.rejects(service.revokeSession(second.token), error => error.code === 'not_found')
})

test('parallel logins have independent credentials; revoking one leaves others intact', async () => {
  const blob = new FakeBlob()
  const storage = createEdgeOneBlobStorage(blob)
  const service = createBackendService({ storage, multiSessionEnabled: true })
  const registered = await service.register('multi_device_user', 'Password-B123', 'device-A')
  const [b, c] = await Promise.all([
    service.login('multi_device_user', 'Password-B123', 'device-B'),
    service.login('multi_device_user', 'Password-B123', 'device-C'),
  ])
  assert.equal((await service.me(registered.token)).session.deviceId, 'device-A')
  assert.equal((await service.me(b.token)).session.deviceId, 'device-B')
  assert.equal((await service.me(c.token)).session.deviceId, 'device-C')
  assert.notEqual((await service.me(b.token)).session.sessionId,
    (await service.me(c.token)).session.sessionId)

  const prefix = 'accounts/' + b.token.split('.')[1] + '/independent-sessions/'
  assert.equal([...blob.objects.keys()].filter(key => key.startsWith(prefix + 'active/')).length, 2)

  assert.deepEqual(await service.revokeSession(b.token), { revoked: true })
  await assert.rejects(service.me(b.token), error => error.code === 'session_revoked')
  assert.equal((await service.me(c.token)).user.userId, registered.user.userId)
  assert.equal((await service.me(registered.token)).user.userId, registered.user.userId)
  assert.equal([...blob.objects.keys()].filter(key => key.startsWith(prefix + 'revoked/')).length, 1)

  const changed = await service.changePassword(c.token, 'Password-B123', 'Password-C456', 'device-C')
  await assert.rejects(service.me(c.token), error => error.code === 'session_revoked')
  await assert.rejects(service.me(registered.token), error => error.code === 'session_revoked')
  assert.equal((await service.me(changed.token)).user.userId, registered.user.userId)
  const fresh = await service.login('multi_device_user', 'Password-C456', 'device-D')
  assert.equal((await service.me(fresh.token)).session.deviceId, 'device-D')

  const deleted = await service.deleteAccount(changed.token, 'Password-C456')
  assert.equal(deleted.deleted.accountDeleted, true)
  assert.ok(deleted.deleted.independentSessionsDeleted >= 4)
  assert.equal([...blob.objects.keys()].filter(key => key.startsWith(prefix)).length, 0)
  await assert.rejects(service.me(fresh.token), error => error.code === 'invalid_token')
  const next = await service.register('multi_device_user', 'Password-D789', 'new-owner')
  assert.notEqual(next.user.userId, registered.user.userId)
  await assert.rejects(service.me(changed.token), error => error.code === 'session_revoked')
})

test('enabling pilot does not revive previously superseded legacy sessions', async () => {
  const storage = createEdgeOneBlobStorage(new FakeBlob())
  const legacy = createBackendService({ storage })
  const a = await legacy.register('pilot_upgrade_user', 'Password-E123', 'A')
  const b = await legacy.login('pilot_upgrade_user', 'Password-E123', 'B')
  const multi = createBackendService({ storage, multiSessionEnabled: true })
  await assert.rejects(multi.me(a.token), error => error.code === 'session_revoked')
  const c = await multi.login('pilot_upgrade_user', 'Password-E123', 'C')
  assert.equal((await multi.me(b.token)).session.deviceId, 'B')
  assert.equal((await multi.me(c.token)).session.deviceId, 'C')
  await multi.revokeSession(b.token)
  await assert.rejects(multi.me(b.token), error => error.code === 'session_revoked')
  // A rollback to the old mode must not restore the revoked legacy token.
  await assert.rejects(legacy.me(b.token), error => error.code === 'session_revoked')
  await assert.rejects(legacy.me(c.token), error => error.code === 'session_revoked')
})
