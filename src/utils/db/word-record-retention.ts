import type { IWordRecord } from './record'

/**
 * Typing is motor-practice evidence, not an FSRS review event.
 * Keep the historical word/time/letter-errors and compact attempt outcomes,
 * which still drive statistics, error-book and orthography profiles.
 * Omit the per-key interval duplicate and review-policy research snapshots.
 *
 * Do NOT apply this to Learn, unknown legacy mode, rated events, or records
 * with a Learn kind. They participate in FSRS replay and achievements.
 *
 * Pure, idempotent and non-mutating. Existing records are NOT rewritten
 * automatically: S1 workspace/vault/revision integrity forbids silent writes.
 */
export function compactTypingWordRecord(record: IWordRecord): IWordRecord {
  if (
    record.sourceMode !== 'typing' ||
    record.learnItemKind !== undefined ||
    record.reviewRatingDecision !== undefined
  ) return record

  const compact: IWordRecord = { ...record }
  delete compact.learningContext
  delete compact.exerciseCondition
  delete compact.reviewPolicyDecision
  delete compact.reviewEvidence
  delete compact.reviewPolicyShadow
  delete compact.fsrsShadow

  // Preserve latency, wrong attempts and their positions/keys. Per-key
  // timing already remains in record.timing for historical Typing charts.
  if (compact.typingTelemetry) {
    compact.typingTelemetry = {
      ...compact.typingTelemetry,
      attempts: compact.typingTelemetry.attempts.map((attempt) => {
        const shallow = { ...attempt }
        delete shallow.interKeyIntervalsMs
        return shallow
      }),
    }
  }
  return compact
}

export const TYPING_RETENTION_PREVIEW_DAYS = 90
