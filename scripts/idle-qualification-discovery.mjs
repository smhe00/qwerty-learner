/* eslint-env node */
// Official Makers SDK is installed in a temporary directory by the CI job.
// Read project binding only. Never read environment values or mutate projects.
import { appendFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isCurrentStagingProject } from './idle-project-binding.mjs'
import { chinaControlPlaneFailure, chinaMakers } from './idle-china-control-plane.mjs'

const evidence = { check: 'idle-qualification-staging-discovery',
  controlPlaneRegion: 'china', globalFallbackAllowed: false,
  blobWritesAttempted: false, configurationChanged: false, deploymentTriggered: false }
let phase = 'credential-check'
try {
  const token = process.env.EDGEONE_API_TOKEN
  if (!token) throw Error('missing-credential')
  phase = 'sdk-import'
  const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
  const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
  const makers = chinaMakers(Makers, token)
  const matches = []
  let examined = 0
  phase = 'project-list'
  for await (const project of makers.projects.listAll()) {
    if (++examined > 50) throw Error('discovery-budget')
    if (['makers-yggquqwubqul', 'makers-cgemngjuuwle'].includes(project.projectId)) continue
    phase = 'project-detail'
    // SDK normalization discards custom-domain bindings. Inspect the same raw
    // read action and require a passed exact current domain plus staging branch.
    const response = await makers.request('DescribePagesProjects', {
      Filters: [{ Name: 'ProjectId', Values: [project.projectId] }], Offset: 0, Limit: 1,
    }, true)
    const record = response.Projects?.find(row => row.ProjectId === project.projectId)
    if (isCurrentStagingProject(record)) matches.push(project.projectId)
    phase = 'project-list'
  }
  evidence.projectsExamined = examined
  evidence.exactStagingMatches = matches.length
  phase = 'exact-domain-match'
  if (matches.length !== 1 || !/^makers-[a-z0-9-]+$/.test(matches[0])) throw Error('staging-not-unique')
  appendFileSync(process.env.GITHUB_OUTPUT, `project_id=${matches[0]}\n`)
  evidence.verdict = 'PASS'
  evidence.binding = 'passed-exact-t-smhe-cn-and-staging-branch'
} catch (error) {
  evidence.verdict = 'FAIL'
  evidence.failureStage = phase
  Object.assign(evidence, chinaControlPlaneFailure(error))
  if (!process.env.EDGEONE_API_TOKEN) evidence.reason = 'ci-credential-missing'
  process.exitCode = 1
}
writeFileSync(process.env.IDLE_DISCOVERY_REPORT || 'idle-discovery-redacted.json', JSON.stringify(evidence, null, 2) + '\n')
console.log('IDLE_STAGING_DISCOVERY ' + JSON.stringify(evidence))
