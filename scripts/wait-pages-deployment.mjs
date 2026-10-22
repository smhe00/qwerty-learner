/* eslint-env node */
// Read-only: distinguish actual Pages deployment from propagation and browser tests.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export async function waitForPages({ repo, sha, token, phase = 'all', fetcher = fetch,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  // GitHub-hosted Pages builds have been observed succeeding after ~13min.
  // Wait for the exact GitHub Pages deployment, never accept branch pushes
  // or a marker alone as evidence of a successful live deployment.
  deploymentTimeout = 1_800_000, propagationTimeout = 180_000, log = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[a-f0-9]{40}$/.test(sha || '') || !token)
    throw new Error('Pages gate requires repository, full source SHA and read token')
  if (!['all', 'deployment', 'propagation'].includes(phase)) throw new Error('Invalid Pages gate phase')
  async function gh(path) {
    const response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Pages evidence API failed: HTTP ${response.status} (${path})`)
    return response.json()
  }
  async function assertCandidate() {
    const ref = await gh('/git/ref/heads/product/main')
    if (ref.object.sha !== sha) throw new Error('Pages candidate superseded: revalidate latest product/main')
  }
  if (phase !== 'propagation') {
    const deadline = now() + deploymentTimeout
    let deployed = false
    while (now() < deadline) {
      await assertCandidate()
      const ref = await gh('/git/ref/heads/gh-pages')
      const artifactSha = ref.object.sha
      const marker = await gh(`/contents/source-commit.txt?ref=${artifactSha}`)
      if (marker.encoding !== 'base64') throw new Error('Invalid Pages artifact marker encoding')
      if (Buffer.from(marker.content, 'base64').toString('utf8').trim() === sha) {
        const params = new URLSearchParams({ branch: 'gh-pages', head_sha: artifactSha, per_page: '100' })
        const result = await gh(`/actions/runs?${params}`)
        // Source SHA and built artifact SHA are different. Bind to the actual artifact.
        const run = result.workflow_runs?.find(r => r.head_sha === artifactSha &&
          r.head_branch === 'gh-pages' && r.path === 'dynamic/pages/pages-build-deployment')
        if (run?.status === 'completed') {
          if (run.conclusion !== 'success')
            throw new Error(`Pages deployment failed (${run.conclusion}): ${run.html_url}`)
          log(`Pages deployment PASS: source=${sha} artifact=${artifactSha} run=${run.html_url}`)
          deployed = true
          break
        }
      }
      await sleep(5000)
    }
    if (!deployed) throw new Error('Pages deployment timeout: matching artifact deployment did not succeed')
  }
  if (phase !== 'deployment') {
    const deadline = now() + propagationTimeout
    let served = '(unavailable)'
    while (now() < deadline) {
      await assertCandidate()
      try {
        const url = new URL(`https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}/source-commit.txt`)
        url.searchParams.set('pages_probe', `${sha}-${now()}`)
        const response = await fetcher(url.href, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
        served = response.ok ? (await response.text()).trim() : `HTTP ${response.status}`
        if (served === sha) {
          log(`Pages propagation PASS: ${sha}`)
          return
        }
      } catch { served = '(network unavailable)' }
      await sleep(5000)
    }
    throw new Error(`Pages propagation timeout: expected=${sha} served=${served}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await waitForPages({ repo: process.env.GITHUB_REPOSITORY, sha: process.env.PAGES_SOURCE_SHA,
      token: process.env.GH_TOKEN, phase: process.argv[2] || 'all' })
  } catch (error) {
    console.error(`::error::${error.message}`)
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${error.message}\n`)
    process.exitCode = 1
  }
}
