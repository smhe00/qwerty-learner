/**
 * Deployment URL diagnostic only.
 * EdgeOne Maker rewrites the inbound Request.url to its own internal host;
 * neither that host nor caller-controlled Origin/Host headers can certify a
 * project. Append-only event API is enabled without an environment toggle;
 * live bearer authorization, account/device binding and immutable receipts
 * still apply to each request. Single-active-session remains mandatory.
 */
/** Diagnostic ONLY. Never use this to authorize data writes. */
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
