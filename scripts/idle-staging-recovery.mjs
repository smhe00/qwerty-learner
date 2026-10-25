/* eslint-env node */
// Recover ONLY the two nonsecret settings owned by the failed staging test.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertStagingProject } from './idle-staging-environment.mjs'

const keys = ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE']
const report = { check: 'idle-staging-settings-recovery', productionChanged: false,
  deploymentTriggered: false, verdict: 'FAIL' }
const metadata = error => ({
  type: /^[A-Za-z]{1,60}$/.test(error?.name) ? error.name : 'unknown',
  code: /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(error?.code) ? error.code : 'unspecified',
  status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined,
  fieldHints: ['EnvVars', 'Id', 'Key', 'Value', 'empty', 'required', 'ID', 'Security'].filter(word =>
    typeof error?.message === 'string' && error.message.toLowerCase().includes(word.toLowerCase())),
})
let phase = 'preflight'
try {
  assert.equal(process.env.GITHUB_REF_NAME, 'product/main')
  const projectId = process.env.IDLE_QUALIFICATION_PROJECT_ID
  assertStagingProject(projectId)
  assert.equal(process.env.IDLE_QUALIFICATION_PROJECT_VERIFIED, 'EXACT_ETEST_DOMAIN')
  const snapshot = JSON.parse(readFileSync(process.env.IDLE_RECOVERY_SNAPSHOT, 'utf8'))
  assert.equal(snapshot.projectId, projectId)
  assert.equal(snapshot.version, 1)
  assert.deepEqual(snapshot.original, [], 'This recovery accepts only the known absent-key baseline')
  assert.ok(Number.isFinite(Date.parse(snapshot.activationTime)))
  const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
  const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
  assert.ok(process.env.EDGEONE_API_TOKEN)
  const projects = new Makers({ token: process.env.EDGEONE_API_TOKEN }).projects
  const selected = async () => (await projects.listEnvs({ projectId })).filter(row => keys.includes(row.key))
  phase = 'read-current-owned-settings'
  let rows = await selected()
  report.before = keys.map(key => ({ key, count: rows.filter(row => row.key === key).length,
    valueIsOwned: rows.filter(row => row.key === key).every(row => row.value === (key === keys[0] ? snapshot.activationTime : 'true')),
    valueIsDisabled: rows.filter(row => row.key === key).every(row => row.value === (key === keys[0] ? '' : 'false')),
  }))
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length, 'Duplicate settings require operator review')
  for (const row of rows) {
    const owned = row.key === keys[0] ? snapshot.activationTime : 'true'
    const off = row.key === keys[0] ? '' : 'false'
    assert.ok(row.value === owned || row.value === off, 'Concurrent or unreadable values refused')
  }
  // Prior recovery40161791374 already established that SDK key deletion is
  // rejected with InvalidParameter. Do not replay that unchanged failure.
  report.keyDeletionPreviouslyRejected = true
  report.exactBaselineRestored = rows.length === 0
  if (rows.length) {
    // Explicitly disable these two known test settings if provider key-deletion
    // is unavailable. Never call this exact absence restoration.
    phase = 'fail-closed-known-settings'
    // Keep the owned date: the previous empty-date update was rejected with
    // InvalidParameter.Security. Disabling execution alone is sufficient to
    // fail closed and avoids an unsupported empty-value update.
    await projects.setEnvs({ projectId, envVars: [{ key: keys[1], value: 'false' }] })
    rows = await selected()
    report.failClosedSettingsConfirmed = rows.some(row => row.key === keys[1] && row.value === 'false')
    report.activationDateRetained = rows.some(row => row.key === keys[0] && row.value === snapshot.activationTime)
  }
  phase = 'public-runtime-disabled'
  const response = await fetch('https://t.smhe.cn/api/account-policy?recovery=' + Date.now(), {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  })
  assert.equal(response.status, 200)
  const policy = await response.json()
  report.runtimePolicyDisabled = policy.enabled === false && policy.idleDays === 180
  assert.equal(report.runtimePolicyDisabled, true)
  assert.ok(report.exactBaselineRestored || report.failClosedSettingsConfirmed)
  report.verdict = 'PASS'
} catch (error) {
  report.failureStage = phase
  report.failure = metadata(error)
}
writeFileSync(process.env.IDLE_RECOVERY_REPORT || 'idle-staging-recovery-redacted.json', JSON.stringify(report, null, 2) + '\n')
console.log('IDLE_STAGING_RECOVERY ' + JSON.stringify(report))
if (report.verdict !== 'PASS') process.exitCode = 1
