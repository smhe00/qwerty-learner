/**
 * EdgeOne Makers routes a public etest URL through an INTERNAL Node cloud
 * function hostname. Neither Request.url nor caller-supplied Origin/Host/
 * forwarding headers establishes the deployed Maker PROJECT identity.
 *
 * Security invariant: an immutable-learning-event pilot is enabled only
 * through an explicit runtime environment variable configured on a
 * dedicated Maker project, never via a browser-supplied hostname.
 */
export function isImmutableEventPilotEnabled(env) {
  return env?.MULTI_DEVICE_EVENT_PILOT_ENABLED === 'true'
}

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
