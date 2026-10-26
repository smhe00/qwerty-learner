/* eslint-env node */
import assert from 'node:assert/strict'

function revision(value) {
  assert.match(value || '', /^[a-f0-9]{40}$/, 'Missing full branch revision')
  return value
}
async function ancestor(gh, base, head, label) {
  if (base === head) return
  const comparison = await gh('/compare/' + base + '...' + head)
  assert.ok(['ahead', 'identical'].includes(comparison.status) &&
    comparison.base_commit?.sha === base && comparison.merge_base_commit?.sha === base,
  label + ': branch must advance by ancestry, never diverge or move backwards')
}
async function branches(gh) {
  const [main, etest, master] = await Promise.all([
    gh('/branches/product%2Fmain'), gh('/branches/edgeone-test'), gh('/branches/master'),
  ])
  return { main: revision(main.commit?.sha), etest: revision(etest.commit?.sha), master: revision(master.commit?.sha) }
}
/** Source admission does not freeze development or move any branch. */
export async function assertStagingCandidate(gh, sha) {
  revision(sha)
  const refs = await branches(gh)
  await ancestor(gh, sha, refs.main, 'Candidate must belong to product/main')
  await ancestor(gh, refs.master, refs.etest, 'master -> etest')
  await ancestor(gh, refs.etest, sha, 'etest -> staging candidate')
  return refs
}
/** Only the tested etest head may become master; main may already be ahead. */
export async function assertReleaseCandidate(gh, sha) {
  revision(sha)
  const refs = await branches(gh)
  assert.equal(refs.etest, sha, 'Staging branch changed during E2E')
  await ancestor(gh, sha, refs.main, 'etest -> product/main')
  await ancestor(gh, refs.master, sha, 'master -> tested etest')
  return refs
}
export function successfulCandidateRun(history, sha, branch) {
  return history.workflow_runs?.find(run => run.head_sha === sha && run.head_branch === branch &&
    run.status === 'completed' && run.conclusion === 'success')
}
