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
console.log(JSON.stringify({
  sameCommit: sha, passedPagesRun: pass.id, etestCloudJobsPassed: true,
  releaseAuthorized: false, // still requires explicit user approval
}))
