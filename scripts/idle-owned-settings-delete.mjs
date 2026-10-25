/* eslint-env node */
import assert from 'node:assert/strict'
const keys = ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE']
export async function removeOwnedIdleSettings(makers, snapshot) {
  assert.equal(snapshot?.version, 1)
  assert.equal(snapshot.projectId, 'makers-mr6zjv0rh6xt', 'Only the original test project is owned')
  assert.deepEqual(snapshot.original, [], 'Only restore the original absent-key baseline')
  assert.equal(snapshot.activationTime, '2026-10-25T04:14:59.438Z', 'Require immutable original test receipt')
  const read = async () => {
    const response = await makers.request('DescribePagesProjectEnvs', { ProjectId: snapshot.projectId }, true)
    assert.ok(Array.isArray(response.EnvVars))
    return response.EnvVars.filter(row => keys.includes(row.Key))
  }
  let rows = await read()
  assert.equal(new Set(rows.map(row => row.Key)).size, rows.length, 'Duplicate or newly scoped settings refused')
  for (const row of rows) {
    assert.ok(row.Id !== undefined)
    assert.deepEqual([...row.Env].sort(), ['Preview', 'Production'])
    assert.equal(row.Value, row.Key === keys[0] ? snapshot.activationTime : 'false', 'Concurrent/active setting refused')
  }
  const attempted = rows.length
  for (const row of rows) {
    // Official edgeone CLI1.6.46 delete wire shape. SDK0.1.0 incorrectly sends
    // key strings; supply only the exact owned record, never unrelated keys.
    try {
      await makers.request('DeletePagesProjectEnvs', { ProjectId: snapshot.projectId,
        EnvVars: [{ Id: row.Id, Key: row.Key, Value: row.Value }] }, false)
    } catch {
      assert.ok(!(await read()).some(value => value.Id === row.Id), 'Delete result remains unconfirmed')
    }
  }
  rows = await read()
  assert.equal(rows.length, 0, 'Original absence not restored')
  return { restoredOriginalAbsence: true, attempted, remainingOwnedSettings: 0 }
}
