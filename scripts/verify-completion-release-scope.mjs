/* eslint-env node */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export const RELEASE_BRANCH = 'release/production-no-handoff-20261026-v2'
export const PRODUCTION_BASE = '9620e33c845f59d31cba107e14dd30754a8c0ca5'
export const APPROVED_RUNTIME = ['cloud-functions/_shared/runtime-environment.js', 'cloud-functions/_shared/session-handoff-deployment-policy.js', 'cloud-functions/_shared/session-handoff-gateway.js'].sort()
export function assertReleaseScope(manifest, changedFiles) {
  assert.equal(manifest.sourceBranch, RELEASE_BRANCH, 'Unapproved release branch')
  assert.equal(manifest.productionBase, PRODUCTION_BASE, 'Production base changed')
  assert.equal(manifest.ownerAuthorized, true, 'Explicit release authority missing')
  const runtime = changedFiles.filter(file => file !== 'AGENTS.md' && !/^(tests|scripts|interactive|[.]github)\//.test(file)).sort()
  assert.deepEqual(runtime, APPROVED_RUNTIME, 'Release contains unapproved runtime changes')
}
export function verifyReleaseScope() {
  const manifest = JSON.parse(readFileSync('interactive/releases/LEARN-COMPLETION-20261026.json','utf8'))
  execFileSync('git',['merge-base','--is-ancestor',PRODUCTION_BASE,'HEAD'])
  const changed = execFileSync('git',['diff','--name-only',PRODUCTION_BASE,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
  assertReleaseScope(manifest,changed)
  const verifiedRuntime = {"cloud-functions/_shared/runtime-environment.js":"784b97228a0a90f86148c66a5cffc4b08123ea4e","cloud-functions/_shared/session-handoff-deployment-policy.js":"50e222203913d2fca17523a25d44733a786ff13e","cloud-functions/_shared/session-handoff-gateway.js":"6234adfcda53549baf5e07253d1add56e078395a"}
  for (const [file, expected] of Object.entries(verifiedRuntime)) assert.equal(execFileSync('git',['hash-object',file],{encoding:'utf8'}).trim(),expected,'Reviewed runtime bytes changed: '+file)
  console.log(JSON.stringify({releaseScope:'PASS',sourceBranch:RELEASE_BRANCH,base:PRODUCTION_BASE,runtimeFiles:APPROVED_RUNTIME}))
  return manifest
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) verifyReleaseScope()
