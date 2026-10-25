/* eslint-env node */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { removeOwnedIdleSettings } from './idle-owned-settings-delete.mjs'
const report = { check: 'original-idle-test-metadata-rollback', productionChanged: false, deploymentTriggered: false }
try {
  assert.equal(process.env.GITHUB_REF_NAME, 'product/main')
  assert.ok(process.env.EDGEONE_API_TOKEN)
  const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
  const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
  const snapshot = JSON.parse(readFileSync(process.env.IDLE_RECOVERY_SNAPSHOT, 'utf8'))
  Object.assign(report, await removeOwnedIdleSettings(new Makers({ token: process.env.EDGEONE_API_TOKEN, region: 'global' }), snapshot))
  report.verdict = 'PASS'
} catch {
  report.verdict = 'FAIL'
  report.reason = 'exact-owned-metadata-restoration-not-confirmed'
  process.exitCode = 1
}
writeFileSync(process.env.IDLE_RECOVERY_REPORT, JSON.stringify(report, null, 2) + '\n')
console.log('IDLE_ORIGINAL_METADATA_ROLLBACK ' + JSON.stringify(report))
