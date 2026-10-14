/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForPages } from '../../scripts/wait-pages-deployment.mjs'

const sha = 'a'.repeat(40)
const artifact = 'b'.repeat(40)
function fixture({ conclusion = 'success', served = sha, marker = sha, wrongRun = false, advanced = false } = {}) {
  let clock = 0
  const calls = []
  const options = { repo: 'owner/repo', sha, token: 'read-test-token', log: () => {},
    deploymentTimeout: 10_000, propagationTimeout: 10_000,
    now: () => clock, sleep: async ms => { clock += ms },
    fetcher: async url => {
      calls.push(url)
      let body
      if (url.includes('/git/ref/heads/product/main')) body = { object: { sha: advanced ? artifact : sha } }
      else if (url.includes('/git/ref/heads/gh-pages')) body = { object: { sha: artifact } }
      else if (url.includes('/contents/')) body = { encoding: 'base64', content: Buffer.from(marker).toString('base64') }
      else if (url.includes('/actions/runs?')) body = { workflow_runs: [{ head_sha: wrongRun ? sha : artifact,
        head_branch: 'gh-pages', path: 'dynamic/pages/pages-build-deployment', status: 'completed',
        conclusion, html_url: 'https://github.com/owner/repo/actions/runs/123' }] }
      else return { ok: true, text: async () => served }
      return { ok: true, json: async () => body }
    } }
  return { options, calls }
}
test('binds deployment to artifact SHA before exact live source SHA', async () => {
  const { options, calls } = fixture()
  await waitForPages(options)
  assert.ok(calls.find(url => url.includes(`head_sha=${artifact}`)))
  assert.ok(calls.at(-1).includes('pages_probe='))
})
test('failed actual deployment stops before browser/propagation', async () => {
  const { options, calls } = fixture({ conclusion: 'failure' })
  await assert.rejects(waitForPages(options), /Pages deployment failed.*runs\/123/)
  assert.equal(calls.some(url => url.includes('github.io')), false)
})
test('unrelated successful deployment cannot satisfy candidate', async () => {
  await assert.rejects(waitForPages(fixture({ wrongRun: true }).options), /deployment timeout/)
})
test('wrong artifact source marker cannot satisfy candidate', async () => {
  await assert.rejects(waitForPages(fixture({ marker: artifact }).options), /deployment timeout/)
})
test('old live source after deployment reports propagation timeout', async () => {
  await assert.rejects(waitForPages(fixture({ served: artifact }).options), /propagation timeout/)
})
test('advanced main fails closed', async () => {
  await assert.rejects(waitForPages(fixture({ advanced: true }).options), /candidate superseded/)
})
test('evidence API failures are not browser failures', async () => {
  const { options } = fixture()
  options.fetcher = async () => ({ ok: false, status: 403 })
  await assert.rejects(waitForPages(options), /evidence API failed: HTTP 403/)
})

test('pending deployment is awaited before propagation', async () => {
  const { options, calls } = fixture()
  const original = options.fetcher
  let polls = 0
  options.fetcher = async url => {
    const response = await original(url)
    if (url.includes('/actions/runs?') && ++polls === 1) {
      const body = await response.json()
      body.workflow_runs[0].status = 'in_progress'
      return { ok: true, json: async () => body }
    }
    return response
  }
  await waitForPages(options)
  assert.equal(polls, 2)
  assert.ok(calls.at(-1).includes('github.io'))
})
test('cancelled deployment remains a hard failure', async () => {
  await assert.rejects(waitForPages(fixture({ conclusion: 'cancelled' }).options), /deployment failed \(cancelled\)/)
})
