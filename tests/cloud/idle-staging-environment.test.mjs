/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStagingEnvironment, restoreStagingEnvironment, snapshotStagingEnvironment } from '../../scripts/idle-staging-environment.mjs'

function fixture(original = []) {
  const env = new Map([['ADMIN_PASSWORD', 'private-sentinel'], ['UNRELATED', 'keep'], ...original.map(row => [row.key, row.value])])
  const writes = []
  const projects = {
    async listEnvs() { return [...env].map(([key, value]) => ({ key, value })) },
    async setEnvs({ envVars }) { writes.push(envVars.map(row => row.key)); for (const row of envVars) env.set(row.key, row.value) },
    async deleteEnvs({ keys }) { writes.push(keys); for (const key of keys) env.delete(key) },
  }
  return { env, writes, projects, id: 'makers-isolated-staging-fixture' }
}

test('production and unknown project IDs are rejected before any environment read/write', async () => {
  for (const id of ['makers-yggquqwubqul', 'makers-cgemngjuuwle', '', 'wrong']) {
    let calls = 0
    await assert.rejects(snapshotStagingEnvironment({ listEnvs() { calls++ } }, id))
    assert.equal(calls, 0)
  }
})
test('only two nonsecret idle settings enter snapshots; new keys are removed on rollback', async () => {
  const f = fixture()
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  assert.deepEqual(snapshot.original, [])
  assert.ok(!JSON.stringify(snapshot).includes('private-sentinel'))
  await applyStagingEnvironment(f.projects, snapshot)
  assert.equal(f.env.get('IDLE_CLEANUP_EXECUTE'), 'true')
  assert.equal((await restoreStagingEnvironment(f.projects, snapshot)).restored, true)
  assert.equal(f.env.has('IDLE_POLICY_START_AT'), false)
  assert.equal(f.env.has('IDLE_CLEANUP_EXECUTE'), false)
  assert.equal(f.env.get('ADMIN_PASSWORD'), 'private-sentinel')
  assert.equal(f.env.get('UNRELATED'), 'keep')
  assert.ok(f.writes.flat().every(key => key.startsWith('IDLE_')))
})
test('previous activation date/disabled flag are restored exactly', async () => {
  const old = [{ key: 'IDLE_POLICY_START_AT', value: '2026-10-24T10:00:00Z' }, { key: 'IDLE_CLEANUP_EXECUTE', value: 'false' }]
  const f = fixture(old)
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  await applyStagingEnvironment(f.projects, snapshot)
  await restoreStagingEnvironment(f.projects, snapshot)
  for (const row of old) assert.equal(f.env.get(row.key), row.value)
})
test('lost apply acknowledgement can still be rolled back from pre-write snapshot', async () => {
  const f = fixture()
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  const normal = f.projects.setEnvs
  f.projects.setEnvs = async input => { await normal(input); throw Error('lost ACK') }
  await assert.rejects(applyStagingEnvironment(f.projects, snapshot))
  f.projects.setEnvs = normal
  assert.equal((await restoreStagingEnvironment(f.projects, snapshot)).restored, true)
})
test('lost rollback acknowledgement is verified by canonical readback', async () => {
  const f = fixture()
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  await applyStagingEnvironment(f.projects, snapshot)
  const remove = f.projects.deleteEnvs
  f.projects.deleteEnvs = async input => { await remove(input); throw Error('lost ACK') }
  const result = await restoreStagingEnvironment(f.projects, snapshot)
  assert.equal(result.restored, true)
  assert.equal(result.acknowledgementLost, true)
})
test('operator concurrent change is never overwritten during apply or rollback', async () => {
  const f = fixture()
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  f.env.set('IDLE_CLEANUP_EXECUTE', 'false')
  await assert.rejects(applyStagingEnvironment(f.projects, snapshot))
  f.env.delete('IDLE_CLEANUP_EXECUTE')
  await applyStagingEnvironment(f.projects, snapshot)
  f.env.set('IDLE_POLICY_START_AT', '2027-01-01T00:00:00Z')
  const writes = f.writes.length
  await assert.rejects(restoreStagingEnvironment(f.projects, snapshot))
  assert.equal(f.writes.length, writes)
  assert.equal(f.env.get('IDLE_POLICY_START_AT'), '2027-01-01T00:00:00Z')
})
test('tampered snapshots cannot restore other environment variables or backdate activation', async () => {
  const f = fixture()
  const snapshot = await snapshotStagingEnvironment(f.projects, f.id)
  await assert.rejects(restoreStagingEnvironment(f.projects, {
    ...snapshot, original: [{ key: 'ADMIN_PASSWORD', value: 'forbidden' }],
  }))
  await assert.rejects(applyStagingEnvironment(f.projects, {
    ...snapshot, activationTime: '2020-01-01T00:00:00Z',
  }))
  assert.equal(f.writes.length, 0)
  assert.equal(f.env.get('ADMIN_PASSWORD'), 'private-sentinel')
})
