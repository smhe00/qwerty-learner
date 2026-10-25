/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { removeOwnedIdleSettings } from '../../scripts/idle-owned-settings-delete.mjs'
function fixture() {
  const snapshot = { version: 1, projectId: 'makers-mr6zjv0rh6xt', original: [], activationTime: '2026-10-25T04:14:59.438Z' }
  let rows = [
    { Id: 'first', Key: 'IDLE_POLICY_START_AT', Value: snapshot.activationTime, Env: ['Production', 'Preview'] },
    { Id: 'second', Key: 'IDLE_CLEANUP_EXECUTE', Value: 'false', Env: ['Preview', 'Production'] },
    { Id: 'other', Key: 'UNRELATED', Value: 'retain', Env: ['Production'] },
  ]
  const deleted = []
  const makers = { async request(action, body) {
    assert.equal(body.ProjectId, snapshot.projectId)
    if (action === 'DescribePagesProjectEnvs') return { EnvVars: structuredClone(rows) }
    assert.equal(action, 'DeletePagesProjectEnvs')
    assert.equal(body.EnvVars.length, 1)
    const row = body.EnvVars[0]
    assert.equal(row.Value, rows.find(value => value.Id === row.Id).Value)
    assert.deepEqual(Object.keys(row).sort(), ['Id', 'Key', 'Value'])
    deleted.push(row.Key)
    rows = rows.filter(value => value.Id !== row.Id)
  } }
  return { makers, snapshot, deleted, rows: () => rows }
}
test('only exact temporary records are deleted; repeating restores absence safely', async () => {
  const f = fixture()
  const first = await removeOwnedIdleSettings(f.makers, f.snapshot)
  assert.equal(first.restoredOriginalAbsence, true)
  assert.deepEqual(f.deleted, ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE'])
  assert.equal(f.rows()[0].Key, 'UNRELATED')
  assert.equal((await removeOwnedIdleSettings(f.makers, f.snapshot)).attempted, 0)
})
test('wrong project, receipt or original baseline fail before any deletion', async () => {
  for (const patch of [{ projectId: 'makers-yggquqwubqul' }, { activationTime: '2026-10-25T00:00:00Z' }, { original: [{}] }]) {
    const f = fixture()
    await assert.rejects(removeOwnedIdleSettings(f.makers, { ...f.snapshot, ...patch }))
    assert.equal(f.deleted.length, 0)
  }
})
test('changed values, duplicate keys or custom scopes refuse the entire batch', async () => {
  for (const mutate of [rows => { rows[1].Value = 'true' }, rows => { rows[0].Value = '2030-01-01' },
    rows => { rows[0].Env = ['custom'] }, rows => { rows.push({ ...rows[0], Id: 'new-record' }) }]) {
    const f = fixture()
    mutate(f.rows())
    await assert.rejects(removeOwnedIdleSettings(f.makers, f.snapshot))
    assert.equal(f.deleted.length, 0)
  }
})
test('lost delete acknowledgement succeeds only after a canonical absence check', async () => {
  const f = fixture()
  const request = f.makers.request
  f.makers.request = async (action, body) => {
    const value = await request(action, body)
    if (action === 'DeletePagesProjectEnvs') throw Error('synthetic lost ack')
    return value
  }
  assert.equal((await removeOwnedIdleSettings(f.makers, f.snapshot)).restoredOriginalAbsence, true)
  const g = fixture()
  const request2 = g.makers.request
  g.makers.request = async (action, body) => {
    if (action === 'DeletePagesProjectEnvs') throw Error('synthetic request not executed')
    return request2(action, body)
  }
  await assert.rejects(removeOwnedIdleSettings(g.makers, g.snapshot))
  assert.equal(g.rows().length, 3)
})
