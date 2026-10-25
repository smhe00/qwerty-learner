/* eslint-env node */
// Read-only protocol/schema diagnosis. Never log values, IDs or secret payloads.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertStagingProject } from './idle-staging-environment.mjs'

const report = { check: 'idle-staging-env-binding-readonly', configurationChanged: false,
  deploymentTriggered: false, credentialValuesLogged: false, regions: [] }
const projectId = process.env.IDLE_QUALIFICATION_PROJECT_ID
assertStagingProject(projectId)
assert.equal(process.env.IDLE_QUALIFICATION_PROJECT_VERIFIED, 'EXACT_ETEST_DOMAIN')
assert.ok(process.env.EDGEONE_API_TOKEN)
const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
const fields = value => Object.keys(value || {}).filter(key => /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key)).sort()
const metaNames = ['Type', 'Env', 'Scope', 'Environment', 'Target', 'Environments', 'EnvType', 'Status', 'IsSecret', 'IsPublic']
const safeEnumValue = value => typeof value === 'string' &&
  /^(all|build|runtime|production|preview|cloud.?functions?|edge.?functions?)$/i.test(value)
for (const region of ['china', 'global']) {
  const item = { region }
  try {
    const makers = new Makers({ token: process.env.EDGEONE_API_TOKEN, region })
    // Same Describe actions used by the official public SDK; raw read is only
    // to inspect field names/scopes discarded by its EnvVar normalization.
    assert.equal(typeof makers.request, 'function')
    const raw = await makers.request('DescribePagesProjectEnvs', { ProjectId: projectId }, true)
    const rows = (Array.isArray(raw.EnvVars) ? raw.EnvVars : []).filter(row =>
      ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE'].includes(row.Key))
    item.responseFields = fields(raw)
    item.settings = rows.map(row => ({
      key: row.Key, fieldNames: fields(row), hasRecordId: row.Id !== undefined,
      dateValueValid: row.Key === 'IDLE_POLICY_START_AT' ? Number.isFinite(Date.parse(String(row.Value || ''))) : undefined,
      executionValueFalse: row.Key === 'IDLE_CLEANUP_EXECUTE' ? row.Value === 'false' : undefined,
      metadata: Object.fromEntries(metaNames.filter(key => row[key] !== undefined).map(key => {
        const value = row[key]
        if (Array.isArray(value)) return [key, value.slice(0, 8).map(item => safeEnumValue(item) ? item : typeof item)]
        return [key, safeEnumValue(value) || typeof value === 'boolean' || (Number.isInteger(value) && value >= 0 && value <= 10) ? value : typeof value]
      })),
    }))
    const readProject = async id => {
      const response = await makers.request('DescribePagesProjects', {
        Filters: [{ Name: 'ProjectId', Values: [id] }], Offset: 0, Limit: 1,
      }, true)
      const record = response.Projects?.find(row => row.ProjectId === id)
      assert.ok(record, 'Exact requested record absent')
      return record
    }
    const record = await readProject(projectId)
    item.projectRecordFields = fields(record)
    const serializedDomains = JSON.stringify(record.CustomDomains || [])
    item.binding = {
      stagingCustomDomainPresent: serializedDomains.includes('t.smhe.cn'),
      productionCustomDomainPresent: serializedDomains.includes('q.smhe.cn'),
      expectedStagingBranch: record.RepoBranch === 'edgeone-test',
      mainBranchUnexpected: record.RepoBranch === 'product/main',
      presetDomainExpected: typeof record.PresetDomain === 'string' && record.PresetDomain.includes('etest.edgeone.dev'),
      projectEnvShape: Array.isArray(record.EnvVars) ? 'array' : typeof record.EnvVars,
      projectEnvHasIdleDate: JSON.stringify(record.EnvVars || {}).includes('IDLE_POLICY_START_AT'),
      area: ['global', 'overseas', 'mainland', 'china'].includes(record.Area) ? record.Area : typeof record.Area,
      regionFieldNames: fields(record.Regions),
    }
    item.projectCatalog = []
    for await (const candidate of makers.projects.listAll()) {
      if (item.projectCatalog.length >= 50) throw Error('Catalog budget exceeded')
      const row = await readProject(candidate.projectId)
      const domains = JSON.stringify(row.CustomDomains || [])
      item.projectCatalog.push({
        selectedByOldDiscovery: candidate.projectId === projectId,
        knownProduction: candidate.projectId === 'makers-yggquqwubqul',
        previouslyDeniedObsolete: candidate.projectId === 'makers-cgemngjuuwle',
        stagingDomain: domains.includes('t.smhe.cn'), productionDomain: domains.includes('q.smhe.cn'),
        customDomainShape: Array.isArray(row.CustomDomains) ? 'array' : typeof row.CustomDomains,
        customDomainCount: Array.isArray(row.CustomDomains) ? row.CustomDomains.length : undefined,
        stagingBranch: row.RepoBranch === 'edgeone-test', productionBranch: row.RepoBranch === 'master',
        oldPreset: row.PresetDomain === 'etest.edgeone.dev',
        projectHasIdleSettings: JSON.stringify(row.EnvVars || {}).includes('IDLE_POLICY_START_AT'),
      })
    }
    item.outcome = 'OBSERVED'
  } catch (error) {
    item.outcome = 'UNAVAILABLE'
    item.errorType = /^[A-Za-z]{1,60}$/.test(error?.name) ? error.name : 'unknown'
    item.errorCode = /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(error?.code) ? error.code : 'unspecified'
  }
  report.regions.push(item)
}
writeFileSync(process.env.IDLE_BINDING_AUDIT_REPORT || 'idle-binding-audit-redacted.json', JSON.stringify(report, null, 2) + '\n')
console.log('IDLE_BINDING_AUDIT ' + JSON.stringify(report))
if (!report.regions.some(item => item.outcome === 'OBSERVED')) process.exitCode = 1
