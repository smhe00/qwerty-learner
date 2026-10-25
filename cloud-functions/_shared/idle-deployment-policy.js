/* eslint-env node */
// Nonsecret release policy. Deploying this code enables the existing independent
// maintenance path. No console edit, API token or external scheduler is needed.
// Set enabled=false in a normal code release to stop destructive maintenance.
export const IDLE_DEPLOYMENT_POLICY = Object.freeze({ enabled: true })

export function idleDeploymentOptions(env, policy = IDLE_DEPLOYMENT_POLICY) {
  return {
    startAt: env.IDLE_POLICY_START_AT,
    automaticStart: policy.enabled && env.IDLE_POLICY_START_AT === undefined,
    // An explicitly configured stop/invalid value remains fail-closed. A code
    // rollback also stops execution even if an old environment says true.
    execute: policy.enabled && (env.IDLE_CLEANUP_EXECUTE === undefined || env.IDLE_CLEANUP_EXECUTE === 'true'),
  }
}
