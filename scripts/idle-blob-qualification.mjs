/* eslint-env node */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getStore } from '@edgeone/pages-blob'
import { qualifyIdleLifecycle } from './idle-blob-qualification-core.mjs'

const projectId = process.env.IDLE_QUALIFICATION_PROJECT_ID || ''
const token = process.env.EDGEONE_API_TOKEN || ''
const storeName = 'qwerty-idle-qualification'
const output = resolve(process.env.IDLE_QUALIFICATION_OUTPUT || '.diagnostic/idle-blob-qualification')
mkdirSync(output, { recursive: true })
let report
try {
  assert.equal(process.env.IDLE_QUALIFICATION_ACK, 'RUN_ISOLATED_IDLE_LIFECYCLE')
  assert.equal(process.env.IDLE_QUALIFICATION_PROJECT_VERIFIED, 'EXACT_ETEST_DOMAIN')
  assert.match(projectId, /^makers-[a-z0-9-]+$/)
  assert.ok(!['makers-yggquqwubqul', 'makers-cgemngjuuwle'].includes(projectId))
  assert.ok(token)
  const clients = [0, 1].map(() => getStore({ name: storeName, projectId, token, consistency: 'strong' }))
  report = await qualifyIdleLifecycle({
    clients, transport: 'edgeone-blob-sdk',
    onTrack: ledger => writeFileSync(resolve(output, 'sandbox-ledger.json'),
      JSON.stringify({ ...ledger, projectId, store: storeName }, null, 2) + '\n'),
    onCase: result => console.log('IDLE_BLOB_CASE ' + JSON.stringify(result)),
  })
} catch {
  report = { check: 'isolated-idle-blob-lifecycle-v1', verdict: 'FAIL',
    failureType: 'preflight-or-runner', credentialValuesLogged: false }
}
writeFileSync(resolve(output, 'redacted-result.json'), JSON.stringify(report, null, 2) + '\n')
console.log('IDLE_BLOB_QUALIFICATION ' + JSON.stringify(report))
if (report.verdict !== 'PASS') process.exitCode = 1
