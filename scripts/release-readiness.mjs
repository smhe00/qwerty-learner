/* eslint-env node */
import assert from 'node:assert/strict'
import { assertReleaseCandidate, successfulCandidateRun } from './release-branch-policy.mjs'

const sha = process.env.EXPECTED_SHA
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GH_TOKEN
assert.equal(process.env.QWERTY_RELEASE_TARGET_BRANCH || process.env.GITHUB_REF_NAME, 'edgeone-test')
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
await assertReleaseCandidate(gh, sha)
// The release policy may run on continuously advancing main, but every cloud
// job it accepts must belong to the fixed etest candidate and the named run.
const cloudRunId = process.env.QWERTY_CLOUD_RUN_ID || process.env.GITHUB_RUN_ID
assert.match(cloudRunId || '', /^[0-9]+$/, 'Candidate Cloud workflow run required')
const cloudRun = await gh('/actions/runs/' + cloudRunId)
assert.equal(cloudRun.head_sha, sha, 'Cloud workflow belongs to a different SHA')
assert.equal(cloudRun.head_branch, 'edgeone-test', 'Cloud workflow must run on etest')
assert.equal(cloudRun.path, '.github/workflows/edgeone-branch-cloud-e2e.yml', 'Wrong Cloud workflow')
const cloudJobs = await gh('/actions/runs/' + cloudRunId + '/jobs?filter=latest&per_page=100')
for (const name of ['real-v4-transport', 'live-browser-cloud']) {
  assert.ok(cloudJobs.jobs?.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'),
    'Candidate Cloud job did NOT pass: ' + name)
}
const params = new URLSearchParams({
  branch: 'product/main', head_sha: sha, per_page: '30',
})
const history = await gh('/actions/workflows/deploy-pages.yml/runs?' + params)
const pass = successfulCandidateRun(history, sha, 'product/main')
assert.ok(pass, 'Published Pages deployment/regression did NOT pass for this SHA')
// That completed workflow verified the published candidate's source marker and
// browser path. Current Pages follows main; a newer preview cannot revoke it.
const cloudHistory = await gh('/actions/workflows/cloud-sync.yml/runs?' + params)
const cloudPass = successfulCandidateRun(cloudHistory, sha, 'product/main')
assert.ok(cloudPass, 'Source Cloud Sync Gate did NOT pass for this SHA')
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
const qualifiedBranches = await assertReleaseCandidate(gh, sha)
const deployed = await fetch('https://t.smhe.cn/source-commit.txt?release_candidate=' + sha + '-' + Date.now(), {
  cache: 'no-store', signal: AbortSignal.timeout(15000),
})
assert.equal(deployed.status, 200, 'etest deployed source marker unavailable')
const marker = (await deployed.text()).trim()
assert.ok(marker === sha || marker === sha.slice(0, 7), 'etest is not serving the qualified candidate')
console.log(JSON.stringify({
  sameCommit: sha, policyCommit: process.env.GITHUB_SHA || null, cloudWorkflowRun: cloudRun.id, qualifiedBranches, passedPagesRun: pass.id, sourceCloudRun: cloudPass.id, etestCloudJobsPassed: true,
  releaseAuthorized: false, // still requires explicit user approval
}))
