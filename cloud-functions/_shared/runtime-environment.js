/* eslint-env node */
function nodeEnvironment() {
  if (typeof process === 'undefined') return {}
  // Keep literal property access for function bundlers that inject server
  // variables at build time rather than enumerating them in process.env.
  return {
    branch: process.env.branch,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_USER_ID: process.env.ADMIN_USER_ID,
    IDLE_POLICY_START_AT: process.env.IDLE_POLICY_START_AT,
    IDLE_CLEANUP_EXECUTE: process.env.IDLE_CLEANUP_EXECUTE,
  }
}
/** Node Cloud Functions use process.env; Edge contexts may supply env directly. */
export function runtimeEnvironment(contextEnv, nodeEnv = nodeEnvironment()) {
  const result = {}
  // Limit Node fallback to deployment policy and account maintenance: storage/sync/CORS keep their existing
  // configuration source, rather than activating unrelated legacy settings.
  for (const key of ['branch', 'ADMIN_PASSWORD', 'ADMIN_USER_ID', 'IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE']) {
    if (nodeEnv[key] !== undefined) result[key] = nodeEnv[key]
  }
  if (contextEnv && typeof contextEnv === 'object' && !Array.isArray(contextEnv)) {
    for (const [key, value] of Object.entries(contextEnv)) {
      // An explicit empty value remains an override; absent bindings fall back.
      if (value !== undefined) result[key] = value
    }
  }
  return result
}
