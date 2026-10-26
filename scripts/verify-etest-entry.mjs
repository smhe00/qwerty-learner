/* eslint-env node */
// Read-only admission for experimental staging; never moves git refs.
import assert from 'node:assert/strict'
import { assertStagingCandidate } from './release-branch-policy.mjs'
const repo = process.env.GITHUB_REPOSITORY
const sha = process.env.GITHUB_SHA
const token = process.env.GH_TOKEN
assert.equal(process.env.GITHUB_REF_NAME, 'product/main')
assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/)
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.ok(token, 'GitHub read token required')
async function gh(path) {
  const response = await fetch('https://api.github.com/repos/' + repo + path, {
    headers: { Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(response.status, 200, 'GitHub API failure: ' + path)
  return response.json()
}
async function gate(file) {
  const params = new URLSearchParams({
    branch: 'product/main', head_sha: sha, per_page: '30',
  })
  const result = await gh('/actions/workflows/' + file + '/runs?' + params)
  return result.workflow_runs?.find(r =>
    r.head_sha === sha && r.head_branch === 'product/main' &&
    r.status === 'completed')
}
let evidence = null
for (let attempt = 0; attempt < 80; attempt += 1) {
  const [cloud, pages] = await Promise.all([
    process.env.CLOUD_GATE_JOB_PASSED === 'true'
      ? Promise.resolve({ conclusion: 'success', id: process.env.GITHUB_RUN_ID })
      : gate('cloud-sync.yml'),
    gate('deploy-pages.yml'),
  ])
  await assertStagingCandidate(gh, sha)
  if (cloud && cloud.conclusion !== 'success')
    throw new Error('Cloud Sync Gate failed on candidate')
  if (pages && pages.conclusion !== 'success')
    throw new Error('Pages publish/regression workflow failed on candidate: https://github.com/' + repo + '/actions/runs/' + pages.id)
  if (cloud && pages) {
    evidence = { cloudRun: cloud.id, pagesRun: pages.id }
    break
  }
  if (attempt === 79) throw new Error('Pages/Cloud gate did not complete')
  await new Promise(resolve => setTimeout(resolve, 15000))
}
// A successful candidate Pages workflow already checked its deployed SHA and
// browser regression. Do not compare against the moving current main preview.
const qualifiedBranches = await assertStagingCandidate(gh, sha)
const result = { stagingPilotEligible: true, sha, qualifiedBranches, ...evidence,
  etestPromoted: false, fullMultiDeviceGAReady: false,
  masterReleaseAuthorized: false }
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    'Experimental staging admission PASS for ' + sha +
    '\nCloud gate: ' + evidence.cloudRun +
    '\nPages gate: ' + evidence.pagesRun +
    '\nPilot only; no Etest build triggered. M2/M4 remain blocked.\n')
}
