/* eslint-env node */
// Official Makers SDK is installed in a temporary directory by the CI job.
// Read project binding only. Never read environment values or mutate projects.
import { appendFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const evidence = { check: 'idle-qualification-staging-discovery',
  blobWritesAttempted: false, configurationChanged: false, deploymentTriggered: false }
let phase = 'credential-check'
try {
  const token = process.env.EDGEONE_API_TOKEN
  if (!token) throw Error('missing-credential')
  phase = 'sdk-import'
  const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
  const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
  const makers = new Makers({ token })
  const matches = []
  let examined = 0
  const hostname = value => {
    if (value && typeof value === 'object') value = value.domain || value.domainName || value.name
    if (typeof value !== 'string') return ''
    try { return new URL(value.includes('://') ? value : 'https://' + value).hostname.toLowerCase() }
    catch { return '' }
  }
  phase = 'project-list'
  for await (const project of makers.projects.listAll()) {
    if (++examined > 50) throw Error('discovery-budget')
    if (['makers-yggquqwubqul', 'makers-cgemngjuuwle'].includes(project.projectId)) continue
    phase = 'project-detail'
    const detail = await makers.projects.get({ projectId: project.projectId })
    const domains = [project.presetDomain, detail.presetDomain,
      ...(Array.isArray(detail.domains) ? detail.domains : []),
      ...(Array.isArray(detail.customDomains) ? detail.customDomains : []),
    ].map(hostname)
    if (domains.includes('t.smhe.cn') || domains.includes('etest.edgeone.dev')) matches.push(project.projectId)
    phase = 'project-list'
  }
  evidence.projectsExamined = examined
  evidence.exactStagingMatches = matches.length
  phase = 'exact-domain-match'
  if (matches.length !== 1 || !/^makers-[a-z0-9-]+$/.test(matches[0])) throw Error('staging-not-unique')
  appendFileSync(process.env.GITHUB_OUTPUT, `project_id=${matches[0]}\n`)
  evidence.verdict = 'PASS'
  evidence.binding = 'exact-etest-domain'
} catch {
  evidence.verdict = 'FAIL'
  evidence.failureStage = phase
  evidence.reason = process.env.EDGEONE_API_TOKEN ? 'staging-discovery-unavailable-or-not-unique' : 'ci-credential-missing'
  process.exitCode = 1
}
writeFileSync(process.env.IDLE_DISCOVERY_REPORT || 'idle-discovery-redacted.json', JSON.stringify(evidence, null, 2) + '\n')
console.log('IDLE_STAGING_DISCOVERY ' + JSON.stringify(evidence))
