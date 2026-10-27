const WITNESS_FAILURES = new Set([
  'verification-budget-exceeded',
  'gap-or-stale-read',
  'verification-device-fork',
  'verification-attempt-conflict',
  'verification-checkpoint-invalid',
  'verification-checkpoint-missing',
  'verification-checkpoint-unconfirmed',
  'verification-local-checkpoint-failed',
  'verification-owner-changed',
  'verification-session-revoked',
  'verification-request-aborted',
  'verification-network-failed',
  'verification-server-failed',
  'event_chain_integrity_failed',
  'event_chain_fork_conflict',
  'event_chain_attempt_conflict',
])
export function safeWitnessFailure(reason: unknown, fallback = 'witness-server-unverified'): string {
  return typeof reason === 'string' && WITNESS_FAILURES.has(reason) ? reason : fallback
}
