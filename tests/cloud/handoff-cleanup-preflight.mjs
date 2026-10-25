/* eslint-env node */
// Fresh handoff fixtures cannot be180-day cleanup candidates. Coexistence with
// automatic maintenance is safe only with the exact retention/capability proof.
export function fixtureCleanupPolicySafe(health, policy) {
  return policy?.idleDays === 180 && (policy.executionEnabled === false ||
    (policy.executionEnabled === true && policy.enabled === true &&
      health?.capabilities?.includes('idle-auto-policy-v1') === true))
}
export function newlyCreatedFixtureProtected(health, policy, user) {
  const createdAt = Date.parse(user?.createdAt || '')
  return fixtureCleanupPolicySafe(health, policy) && Number.isFinite(health?.serverTimeMs) &&
    Number.isFinite(createdAt) && createdAt >= health.serverTimeMs - 60_000 &&
    createdAt + policy.idleDays * 86400000 > health.serverTimeMs + 86400000
}
