/* eslint-env node */
import assert from 'node:assert/strict'

const keys = ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE']
const denied = ['makers-yggquqwubqul', 'makers-cgemngjuuwle']
export function assertStagingProject(projectId) {
  assert.match(projectId, /^makers-[a-z0-9-]+$/)
  assert.ok(!denied.includes(projectId), 'Production/obsolete project refused')
}
function selected(rows) {
  assert.ok(Array.isArray(rows))
  const result = rows.filter(row => keys.includes(row.key)).map(({ key, value }) => ({ key, value }))
  assert.equal(new Set(result.map(row => row.key)).size, result.length)
  for (const row of result) {
    assert.equal(typeof row.value, 'string')
    if (row.key === 'IDLE_CLEANUP_EXECUTE') assert.ok(['true', 'false', ''].includes(row.value))
    else assert.ok(row.value === '' || Number.isFinite(Date.parse(row.value)))
  }
  return result.sort((a, b) => a.key.localeCompare(b.key))
}
const equal = (a, b) => JSON.stringify(selected(a)) === JSON.stringify(selected(b))

export async function snapshotStagingEnvironment(projects, projectId) {
  assertStagingProject(projectId)
  return { version: 1, projectId, original: selected(await projects.listEnvs({ projectId })),
    activationTime: new Date().toISOString() }
}
function validate(snapshot) {
  assertStagingProject(snapshot.projectId)
  assert.equal(snapshot.version, 1)
  assert.ok(Number.isFinite(Date.parse(snapshot.activationTime)))
  assert.deepEqual(snapshot.original, selected(snapshot.original), 'Unexpected rollback keys or fields')
}
export async function applyStagingEnvironment(projects, snapshot) {
  validate(snapshot)
  assert.ok(Math.abs(Date.now() - Date.parse(snapshot.activationTime)) < 15 * 60_000, 'Activation snapshot is not fresh')
  const projectId = snapshot.projectId
  assert.ok(equal(await projects.listEnvs({ projectId }), snapshot.original), 'Staging settings changed since snapshot')
  await projects.setEnvs({ projectId, envVars: [
    { key: keys[0], value: snapshot.activationTime }, { key: keys[1], value: 'true' },
  ] })
}
export async function restoreStagingEnvironment(projects, snapshot) {
  validate(snapshot)
  const projectId = snapshot.projectId
  const current = await projects.listEnvs({ projectId })
  if (equal(current, snapshot.original)) return { restored: true, mutationNeeded: false }
  const owned = [
    { key: keys[0], value: snapshot.activationTime }, { key: keys[1], value: 'true' },
  ]
  // Never overwrite an operator's concurrent change with an old snapshot.
  const currentSelected = selected(current)
  for (const key of keys) {
    const value = currentSelected.find(row => row.key === key)?.value
    const old = snapshot.original.find(row => row.key === key)?.value
    const ours = owned.find(row => row.key === key).value
    assert.ok(value === old || value === ours, 'Concurrent staging setting change refused')
  }
  let acknowledgementLost = false
  try {
    if (snapshot.original.length) await projects.setEnvs({ projectId, envVars: snapshot.original })
    const absent = keys.filter(key => !snapshot.original.some(row => row.key === key))
    if (absent.length) await projects.deleteEnvs({ projectId, keys: absent })
  } catch { acknowledgementLost = true }
  // A lost ACK does not prove rollback failed. Verify canonical selected values.
  const restored = equal(await projects.listEnvs({ projectId }), snapshot.original)
  assert.equal(restored, true, 'Staging rollback not confirmed')
  return { restored, mutationNeeded: true, acknowledgementLost }
}
