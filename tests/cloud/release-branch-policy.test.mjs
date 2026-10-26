/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { assertReleaseCandidate, assertStagingCandidate, successfulCandidateRun } from '../../scripts/release-branch-policy.mjs'
const master = 'a'.repeat(40), candidate = 'b'.repeat(40), main = 'c'.repeat(40), other = 'd'.repeat(40)
function github(refs, divergent = false) {
  return async path => {
    const names = { '/branches/master': 'master', '/branches/edgeone-test': 'etest', '/branches/product%2Fmain': 'main' }
    if (names[path]) return { commit: { sha: refs[names[path]] } }
    const [base, head] = path.slice('/compare/'.length).split('...')
    assert.match(base, /^[a-f0-9]{40}$/); assert.match(head, /^[a-f0-9]{40}$/)
    return { status: divergent ? 'diverged' : base < head ? 'ahead' : 'behind',
      base_commit: { sha: base }, merge_base_commit: { sha: divergent ? other : base } }
  }
}
test('release accepts main ahead of tested etest, master behind', async () => {
  assert.deepEqual(await assertReleaseCandidate(github({ main, etest: candidate, master }), candidate), { main, etest: candidate, master })
})
test('staging candidate may be older than the continuously advancing main', async () => {
  await assertStagingCandidate(github({ main, etest: master, master }), candidate)
})
test('equal heads after promotion remain valid', async () => {
  await assertReleaseCandidate(github({ main: candidate, etest: candidate, master: candidate }), candidate)
})
test('changed etest invalidates the old candidate even when main contains both', async () => {
  await assert.rejects(assertReleaseCandidate(github({ main, etest: main, master }), candidate), /Staging branch changed/)
})
test('diverged main cannot qualify a candidate', async () => {
  await assert.rejects(assertReleaseCandidate(github({ main, etest: candidate, master }, true), candidate), /ancestry/)
})
test('production ahead of candidate cannot be rolled back', async () => {
  await assert.rejects(assertReleaseCandidate(github({ main, etest: candidate, master: main }), candidate), /ancestry/)
})
test('staging admission cannot roll back an already newer etest', async () => {
  await assert.rejects(assertStagingCandidate(github({ main, etest: main, master }), candidate), /ancestry/)
})
test('successful evidence must match exact candidate and branch', () => {
  const run = { id: 1, head_sha: candidate, head_branch: 'product/main', status: 'completed', conclusion: 'success' }
  assert.equal(successfulCandidateRun({ workflow_runs: [run] }, candidate, 'product/main'), run)
  for (const altered of [{ head_sha: main }, { head_branch: 'master' }, { status: 'in_progress' }, { conclusion: 'failure' }])
    assert.equal(successfulCandidateRun({ workflow_runs: [{ ...run, ...altered }] }, candidate, 'product/main'), undefined)
})
// Execute the real CLI entrypoints with an in-memory GitHub API. Any request
// for current Pages is forbidden: only that SHA's completed published test is evidence.
function cli(file, options = {}) {
  const url = new URL('../../scripts/' + file, import.meta.url).href
  const code = `
    const options=${JSON.stringify(options)}, candidate='${candidate}', main='${main}', master='${master}';
    let etestReads=0;
    globalThis.fetch=async input=>{
      const u=new URL(input);
      if(u.origin==='https://t.smhe.cn')return new Response(options.wrongDeployment?main:candidate,{status:200});
      if(u.origin!=='https://api.github.com')throw Error('Moving Pages preview must not gate frozen candidate');
      const path=u.pathname.replace('/repos/synthetic/repo','');
      let data;
      if(path==='/branches/product%2Fmain')data={commit:{sha:main}};
      else if(path==='/branches/master')data={commit:{sha:master}};
      else if(path==='/branches/edgeone-test'){etestReads++;data={commit:{sha:options.moved&&etestReads>1?main:candidate}}}
      else if(path.startsWith('/compare/')){const [base,head]=path.slice(9).split('...');data={status:base<head?'ahead':'behind',base_commit:{sha:base},merge_base_commit:{sha:base}}}
      else if(path==='/actions/runs/777')data={id:777,head_sha:options.wrongCloud?main:candidate,head_branch:'edgeone-test',path:'.github/workflows/edgeone-branch-cloud-e2e.yml'};
      else if(path==='/actions/runs/777/jobs')data={jobs:['real-v4-transport','live-browser-cloud'].map(name=>({name,status:'completed',conclusion:options.failedTransport&&name==='real-v4-transport'?'failure':'success'}))};
      else if(path.includes('/actions/workflows/')){
        const isBrowser=path.includes('etest-three-device-auto-fork');
        const isPages=path.includes('deploy-pages');
        data={workflow_runs:[{id:123,head_sha:options.wrongPages&&isPages?main:candidate,
          head_branch:isBrowser?'edgeone-test':'product/main',status:'completed',
          conclusion:options.failedPages&&isPages?'failure':'success'}]};
      }else throw Error('Unexpected API: '+path);
      return new Response(JSON.stringify(data),{status:200});
    };
    await import(${JSON.stringify(url)});
  `
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, EXPECTED_SHA: candidate, GITHUB_SHA: candidate, GITHUB_REPOSITORY: 'synthetic/repo',
      GH_TOKEN: 'synthetic-local-only', QWERTY_CLOUD_RUN_ID: '777', GITHUB_REF_NAME: file === 'release-readiness.mjs' ? 'edgeone-test' : 'product/main' },
    encoding: 'utf8', timeout: 5000,
  })
}
for (const file of ['release-readiness.mjs', 'verify-etest-entry.mjs']) {
  test(file + ' accepts historical exact-SHA Pages evidence while main advances', () => {
    const result = cli(file)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, new RegExp(candidate))
  })
  test(file + ' rejects etest moving during qualification', () => {
    const result = cli(file, { moved: true })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /changed|ancestry/)
  })
}
test('release CLI rejects newer-SHA Pages success and failed candidate Pages', () => {
  for (const options of [{ wrongPages: true }, { failedPages: true }]) {
    const result = cli('release-readiness.mjs', options)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Published Pages deployment/)
  }
})

test('release CLI rejects wrong Cloud SHA, failed transport and mismatched deployed etest', () => {
  for (const options of [{ wrongCloud: true }, { failedTransport: true }, { wrongDeployment: true }]) {
    const result = cli('release-readiness.mjs', options)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /different SHA|Cloud job did NOT pass|not serving/)
  }
})
