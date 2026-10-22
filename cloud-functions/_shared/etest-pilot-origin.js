/**
 * Deliberate ETESТ-ONLY runtime gate. A CORS Origin, arbitrary Host header,
 * or build-time flag MUST NOT activate cloud event pilots on master.
 * Trust only the runtime Request.url representing the matched Maker project.
 */
export function isIsolatedEtestPilotOrigin(input) {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' &&
      url.hostname === 'etest.edgeone.dev' &&
      (url.port === '' || url.port === '443') &&
      !url.username && !url.password
  } catch {
    return false
  }
}
