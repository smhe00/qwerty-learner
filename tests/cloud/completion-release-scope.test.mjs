/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { APPROVED_RUNTIME, PRODUCTION_BASE, RELEASE_BRANCH, assertReleaseScope } from '../../scripts/verify-completion-release-scope.mjs'
const manifest={sourceBranch:RELEASE_BRANCH,productionBase:PRODUCTION_BASE,ownerAuthorized:true}
test('isolated release accepts only gateway scope changes plus tests and evidence',()=>{
  assertReleaseScope(manifest,[...APPROVED_RUNTIME,'tests/e2e/etest-learn-completion.spec.ts','interactive/report.md','.github/workflows/deploy-pages.yml'])
})
for(const file of ['cloud-functions/_shared/core.js','cloud-functions/_shared/idle-deployment-policy.js','src/pages/Mobile/index.tsx','edgeone.json','package.json']){
  test('rejects unrelated runtime change: '+file,()=>assert.throws(()=>assertReleaseScope(manifest,[...APPROVED_RUNTIME,file]),/unapproved runtime/))
}
test('rejects omitted fix, changed base, unapproved branch and missing authority',()=>{
 assert.throws(()=>assertReleaseScope(manifest,APPROVED_RUNTIME.slice(1)),/unapproved runtime/)
 assert.throws(()=>assertReleaseScope({...manifest,productionBase:'a'.repeat(40)},APPROVED_RUNTIME),/base changed/)
 assert.throws(()=>assertReleaseScope({...manifest,sourceBranch:'master'},APPROVED_RUNTIME),/Unapproved release branch/)
 assert.throws(()=>assertReleaseScope({...manifest,ownerAuthorized:false},APPROVED_RUNTIME),/authority missing/)
})
