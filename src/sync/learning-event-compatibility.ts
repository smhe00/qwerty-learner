/** Read-only admission: old snapshots need not satisfy the newer event wire format. */
import type { IWordRecord } from '@/utils/db/record'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const EVENT_RECORD_ISSUES = [
  'missing-attempt-id',
  'missing-source-mode',
  'invalid-attempt-id',
  'invalid-source-mode',
  'invalid-dict',
  'invalid-word',
  'invalid-timestamp',
  'invalid-review-baseline',
  'invalid-record',
  'invalid-serialization',
] as const
export type EventRecordIssue = (typeof EVENT_RECORD_ISSUES)[number]
export type EventCompatibilityAudit = {
  scanned: number
  eligible: number
  snapshotOnly: number
  rejected: number
  issues: Partial<Record<EventRecordIssue, number>>
}

/** These are exactly the existing wire-admission predicates, with fixed reasons. */
export function immutableAttemptIssues(row: IWordRecord): EventRecordIssue[] {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['invalid-record']
  const issues: EventRecordIssue[] = []
  if (row.attemptId === undefined) issues.push('missing-attempt-id')
  else if (!UUID.test(row.attemptId)) issues.push('invalid-attempt-id')
  if (row.sourceMode === undefined) issues.push('missing-source-mode')
  else if (row.sourceMode !== 'learn' && row.sourceMode !== 'typing') issues.push('invalid-source-mode')
  if (typeof row.dict !== 'string' || !row.dict || row.dict.length > 128) issues.push('invalid-dict')
  if (typeof row.word !== 'string' || !row.word || row.word.length > 128) issues.push('invalid-word')
  if (!Number.isSafeInteger(row.timeStamp) || row.timeStamp < 0 || row.timeStamp > 86_400_000_000) issues.push('invalid-timestamp')
  if (
    row.reviewBaseStateFingerprint !== undefined &&
    (!/^[0-9a-f]{64}$/.test(row.reviewBaseStateFingerprint) ||
      row.sourceMode !== 'learn' ||
      row.chapter !== -1 ||
      row.reviewRatingDecision?.eligible !== true)
  )
    issues.push('invalid-review-baseline')
  return issues
}

export function classifyLocalLearningRecord(row: IWordRecord): {
  kind: 'event' | 'snapshot-only' | 'invalid'
  issues: EventRecordIssue[]
} {
  const issues = immutableAttemptIssues(row)
  if (!issues.length) return { kind: 'event', issues }
  // No UUID backfill, provenance guess, deletion or mutation. These rows remain
  // in the audited six-table V4 path, which already supports historical records.
  return {
    kind: issues.every((issue) => issue === 'missing-attempt-id' || issue === 'missing-source-mode') ? 'snapshot-only' : 'invalid',
    issues,
  }
}
