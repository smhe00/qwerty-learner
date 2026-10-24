/** Fixed diagnostics only: never persist raw exceptions, IDs, rows, URLs or credentials. */
const CODES = new Set<string>([
  'auto-merge-account-mismatch',
  'auto-merge-achievement-identity-conflict',
  'auto-merge-archive-owner-mismatch',
  'auto-merge-contradictory-attempt',
  'auto-merge-contradictory-immutable-identity',
  'auto-merge-cross-dictionary-reference',
  'auto-merge-dangling-word-reference',
  'auto-merge-dangling-session-reference',
  'auto-merge-duplicate-achievement-event',
  'auto-merge-duplicate-stable-identity',
  'auto-merge-duplicate-word-state',
  'auto-merge-invalid-achievement',
  'auto-merge-invalid-awards',
  'auto-merge-invalid-chapter-references',
  'auto-merge-invalid-event-id',
  'auto-merge-invalid-primary-key',
  'auto-merge-invalid-references',
  'auto-merge-invalid-session-cursor',
  'auto-merge-invalid-stable-identity',
  'auto-merge-invalid-word-key',
  'auto-merge-missing-daily-session',
  'auto-merge-original-archive-corrupt',
  'auto-merge-row-budget',
  'auto-merge-schema-mismatch',
  'auto-merge-session-header-conflict',
  'auto-merge-unknown-runtime-conflict',
  'auto-merge-unknown-value-prototype',
  'auto-merge-unsupported-table-manifest',
  'auto-merge-unsupported-value',
  'auto-merge-value-budget',
  'auto-merge-lossless-roundtrip:wordRecords',
  'auto-merge-lossless-roundtrip:chapterRecords',
  'auto-merge-lossless-roundtrip:reviewRecords',
  'auto-merge-lossless-roundtrip:reviewWordStates',
  'auto-merge-lossless-roundtrip:achievementEvents',
  'auto-merge-lossless-roundtrip:achievementStates',
  'invalid_response',
  'session_revoked',
  'unauthorized',
  'invalid_binary_manifest',
  'v4_binary_part_failed',
  'v4_binary_part_size_mismatch',
  'v4_binary_part_sha_mismatch',
  'v4_binary_total_size_mismatch',
  'v4_binary_total_sha_mismatch',
  'v4_direct_commit_receipt_mismatch',
  'cloud-metadata-mismatch',
  'cloud-compressed-mismatch',
  'cloud-owner-mismatch',
  'cloud-fingerprint-mismatch',
  'cloud-inflated-size-limit',
  'cloud-table-manifest',
  'cloud-changed-during-merge',
  'previous-journal-pending',
  'merge-candidate-owner',
  'merge-upload-receipt',
  'local-lossless-audit',
  'quota-exceeded',
  'request-aborted',
  'invalid-json',
  'type-error',
  'idb-error',
  'unknown',
])
const MESSAGES: Record<string, string> = {
  'V4 cloud metadata changed, is incomplete, or format unsupported': 'cloud-metadata-mismatch',
  'V4 cloud compressed payload checksum or size mismatch': 'cloud-compressed-mismatch',
  'V4 downloaded snapshot owner mismatch': 'cloud-owner-mismatch',
  'V4 downloaded canonical fingerprint mismatch': 'cloud-fingerprint-mismatch',
  'V4 inflated snapshot exceeds maximum size': 'cloud-inflated-size-limit',
  'V4 full restore missing or duplicate durable tables': 'cloud-table-manifest',
  'Cloud changed during automatic V4 merge': 'cloud-changed-during-merge',
  'Previous S2 journal requires recovery': 'previous-journal-pending',
  'Automatic V4 merge candidate owner mismatch': 'merge-candidate-owner',
  'Automatic V4 merge upload integrity or revision mismatch': 'merge-upload-receipt',
}
const failures = new WeakMap<object, { stage: string; code: string }>()

export function isV4FailureCode(value: unknown): value is string {
  return typeof value === 'string' && CODES.has(value)
}
export function v4FailureCode(error: unknown): string {
  try {
    const e = error as { message?: unknown; code?: unknown; name?: unknown }
    if (isV4FailureCode(e?.code)) return e.code
    if (isV4FailureCode(e?.message)) return e.message
    if (typeof e?.message === 'string') {
      if (Object.prototype.hasOwnProperty.call(MESSAGES, e.message)) return MESSAGES[e.message]
      if (e.message.startsWith('Backup V4 source/export') || e.message.startsWith('Backup V4 independent roundtrip'))
        return 'local-lossless-audit'
    }
    if (e?.name === 'QuotaExceededError') return 'quota-exceeded'
    if (e?.name === 'AbortError') return 'request-aborted'
    if (e?.name === 'SyntaxError') return 'invalid-json'
    if (e?.name === 'TypeError') return 'type-error'
    if (['DataError', 'ConstraintError', 'BulkError', 'DatabaseClosedError', 'UnknownError'].includes(String(e?.name))) return 'idb-error'
  } catch {
    /* Untrusted exception getters cannot affect sync. */
  }
  return 'unknown'
}

/** Preserve the innermost stage and the ORIGINAL error instance/class. */
export function rememberV4Failure(error: unknown, stage: string): void {
  try {
    if (error && typeof error === 'object' && /^[a-z0-9.-]{1,64}$/.test(stage) && !failures.has(error)) {
      failures.set(error, { stage, code: v4FailureCode(error) })
    }
  } catch {
    /* diagnostics never alter the execution result */
  }
}
export function v4FailureDetail(error: unknown): string {
  try {
    const known = error && typeof error === 'object' ? failures.get(error) : undefined
    return '诊断：' + (known?.stage ?? 'sync-preflight') + ' / ' + (known?.code ?? v4FailureCode(error))
  } catch {
    return '诊断：sync-preflight / unknown'
  }
}
