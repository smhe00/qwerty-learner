/* eslint-env node */
import assert from 'node:assert/strict'

const sha = process.env.EXPECTED_SHA
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GH_TOKEN
assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/)
assert.ok(token, 'GitHub read token missing')
async function gh(path) {
  const result = await fetch('https://api.github.com/repos/' + repo + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(result.status, 200, 'GitHub API ' + path)
  return result.json()
}
const [main, etest] = await Promise.all([
  gh('/branches/product%2Fmain'),
  gh('/branches/edgeone-test'),
])
assert.equal(etest.commit.sha, sha, 'Staging branch changed during E2E')
assert.equal(main.commit.sha, sha, 'main and etest must contain IDENTICAL commit SHA')
const params = new URLSearchParams({
  branch: 'product/main', head_sha: sha, per_page: '30',
})
const history = await gh('/actions/workflows/deploy-pages.yml/runs?' + params)
const pass = history.workflow_runs?.find(run =>
  run.head_sha === sha && run.head_branch === 'product/main' &&
  run.status === 'completed' && run.conclusion === 'success')
assert.ok(pass, 'Published Pages deployment/regression did NOT pass for this SHA')
const deployed = await fetch('https://smhe00.github.io/qwerty-learner/source-commit.txt', {
  cache: 'no-store', signal: AbortSignal.timeout(15000),
})
assert.equal(deployed.status, 200, 'Pages deployed SHA marker missing')
assert.equal((await deployed.text()).trim(), sha, 'Pages serves a different commit')
// The existing Pages/Cloud E2E jobs cannot prove that 3 offline Learn
// workspaces automatically adopt one another. Require a separate HARD
// Playwright UI run for this exact SHA before any release-ready claim.
const acceptanceDeadline = Date.now() + 12 * 60_000
let browserResult = null
while (Date.now() < acceptanceDeadline) {
  const query = new URLSearchParams({
    branch: 'edgeone-test', head_sha: sha, per_page: '30',
  })
  const runs = await gh('/actions/workflows/etest-three-device-auto-fork.yml/runs?' + query)
  browserResult = runs.workflow_runs?.find(run =>
    run.head_sha === sha && run.head_branch === 'edgeone-test')
  if (browserResult?.status === 'completed') break
  await new Promise(resolve => setTimeout(resolve, 10_000))
}
assert.ok(browserResult &&
  browserResult.status === 'completed' &&
  browserResult.conclusion === 'success',
  'Hard 3-device offline auto-convergence E2E did NOT pass on this SHA; ' +
  'refusing release-ready declaration. Run=' +
  String(browserResult?.html_url ?? '(not started)'))
console.log(JSON.stringify({
  hardThreeDeviceE2ERun: browserResult.id,
  hardThreeDeviceE2EStatus: browserResult.conclusion,
}))
console.log(JSON.stringify({
  sameCommit: sha, passedPagesRun: pass.id, etestCloudJobsPassed: true,
  releaseAuthorized: false, // still requires explicit user approval
}))
