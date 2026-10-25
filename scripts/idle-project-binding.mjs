/* eslint-env node */
// A legacy preset/repository branch alone never proves the current site's identity.
export function isCurrentStagingProject(record) {
  if (!record || record.RepoBranch !== 'edgeone-test' ||
      !Array.isArray(record.CustomDomains)) return false
  const domains = record.CustomDomains.filter(row => row?.Status === 'Pass').map(row => {
    try { return new URL('https://' + row.Domain).hostname.toLowerCase() } catch { return '' }
  })
  return domains.includes('t.smhe.cn') && !domains.includes('q.smhe.cn')
}
