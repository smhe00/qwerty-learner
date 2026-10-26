/* eslint-env node */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'
import { RELEASE_BRANCH } from '../../scripts/verify-completion-release-scope.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
// Source-selection tests mock only the separately tested immutable scope guard;
// they must not require every future development HEAD to be this release tree.
const compiled = await build({entryPoints:[root + 'scripts/verify-etest-entry.mjs'],bundle:true,write:false,platform:'node',format:'esm',target:'node20',plugins:[{
  name:'isolated-scope-observer', setup(build) {
    build.onResolve({filter:/^\.\/verify-completion-release-scope\.mjs$/},()=>({path:'scope',namespace:'mock'}))
    build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const RELEASE_BRANCH=' + JSON.stringify(RELEASE_BRANCH) + '; export function verifyReleaseScope(){globalThis.__verifiedIndependentScope=true}'}))
  },
}]})
const entry = 'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
const sha = 'a'.repeat(40)
const program = `
const scenario = JSON.parse(process.env.QWERTY_GATE_SCENARIO)
const source = process.env.GITHUB_REF_NAME
const sha = process.env.GITHUB_SHA
const calls = []
globalThis.fetch = async input => {
  const url = new URL(input)
  calls.push(url.pathname)
  if (url.hostname === 'smhe00.github.io') return new Response(scenario.liveMismatch ? 'b'.repeat(40) : sha)
  if (url.hostname !== 'api.github.com') throw Error('Unexpected network destination')
  if (url.pathname.includes('/branches/')) {
    if (!url.pathname.endsWith('/branches/' + encodeURIComponent(source))) throw Error('Wrong source branch queried')
    return Response.json({commit:{sha:scenario.advanced ? 'b'.repeat(40) : sha}})
  }
  if (url.pathname.includes('/actions/workflows/')) {
    if (url.searchParams.get('branch') !== source || url.searchParams.get('head_sha') !== sha) throw Error('Workflow not pinned to exact source')
    return Response.json({workflow_runs:[{id:1,head_sha:sha,head_branch:source,status:'completed',conclusion:scenario.failedPages && url.pathname.includes('deploy-pages') ? 'failure' : 'success'}]})
  }
  throw Error('Unexpected GitHub endpoint')
}
await import(process.env.QWERTY_GATE_ENTRY)
console.log('MOCKED_READS_ONLY', JSON.stringify(calls))
console.log('MOCKED_SCOPE_CHECK',globalThis.__verifiedIndependentScope === true)
`
function check(source, scenario = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-'], {
    cwd: root, input: program, encoding: 'utf8', timeout: 10000,
    env: {...process.env, GITHUB_REF_NAME: source, GITHUB_REPOSITORY: 'smhe00/qwerty-learner', GITHUB_SHA: sha,
      GH_TOKEN:'synthetic-read-token', CLOUD_GATE_JOB_PASSED:'false', GITHUB_STEP_SUMMARY:'',
      QWERTY_GATE_ENTRY:entry, QWERTY_GATE_SCENARIO:JSON.stringify(scenario)},
    stdio:['pipe','pipe','pipe'],
  })
}
for (const source of ['product/main', RELEASE_BRANCH]) {
  test('source admission pins branch, workflow and live artifact: ' + source, () => {
    const result = check(source)
    assert.match(result, /"stagingPilotEligible": true/)
    assert.match(result, /MOCKED_READS_ONLY/)
    assert.ok(result.includes('MOCKED_SCOPE_CHECK ' + String(source === RELEASE_BRANCH)))
  })
}
for (const [scenario, message] of [[{advanced:true},/advanced/],[{failedPages:true},/workflow failed/],[{liveMismatch:true},/Live Pages SHA mismatch/]]) {
  test('independent admission fails closed: ' + JSON.stringify(scenario), () => {
    assert.throws(() => check(RELEASE_BRANCH, scenario), error => message.test(String(error.stderr)))
  })
}
test('master cannot be used as an unapproved source selector', () => {
  assert.throws(() => check('master'), error => /Unapproved staging source branch/.test(String(error.stderr)))
})
