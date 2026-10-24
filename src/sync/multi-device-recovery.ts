/** Recover eligible immutable events without reidentifying older V4-only history. */
import { classifyLocalLearningRecord } from './learning-event-compatibility'
import type { EventCompatibilityAudit } from './learning-event-compatibility'
import { immutableAttempt } from './multi-device-outbox'
import { stableWorkspaceJson } from './workspace-v4'
import type { IWordRecord } from '@/utils/db/record'

export type RecoveryScanResult =
  | {
      status: 'blocked'
      reason: 'invalid-attempt' | 'contradictory-attempt' | 'unbounded-scan'
      count: number
      audit: EventCompatibilityAudit
    }
  | { status: 'ready'; count: number; events: IWordRecord[]; audit: EventCompatibilityAudit }

export function planOutboxRecovery(records: readonly IWordRecord[], maxRecords = 50_000): RecoveryScanResult {
  const audit: EventCompatibilityAudit = { scanned: records.length, eligible: 0, snapshotOnly: 0, rejected: 0, issues: {} }
  if (records.length > maxRecords || maxRecords < 1) {
    return { status: 'blocked', reason: 'unbounded-scan', count: records.length, audit }
  }
  const immutable = new Map<string, IWordRecord>()
  const identities = new Map<string, string>()
  let conflict = false
  for (const record of records) {
    const admission = classifyLocalLearningRecord(record)
    for (const issue of admission.issues) audit.issues[issue] = (audit.issues[issue] ?? 0) + 1
    if (admission.kind === 'invalid') {
      audit.rejected++
      continue
    }
    if (admission.kind === 'snapshot-only') audit.snapshotOnly++
    else audit.eligible++
    try {
      // A known UUID still cannot contradict another local fact, even if a
      // historical copy lacks provenance and is not eligible for publication.
      if (record.attemptId) {
        const { id: _id, fsrsShadow: _fsrs, reviewPolicyShadow: _shadow, ...core } = record
        const key = stableWorkspaceJson(JSON.parse(JSON.stringify(core)))
        const prior = identities.get(record.attemptId)
        if (prior !== undefined && prior !== key) conflict = true
        identities.set(record.attemptId, key)
      }
      if (admission.kind === 'event') {
        const evidence = immutableAttempt(record)
        immutable.set(evidence.attemptId!, evidence)
      }
    } catch {
      if (admission.kind === 'snapshot-only') audit.snapshotOnly--
      else audit.eligible--
      audit.rejected++
      audit.issues['invalid-serialization'] = (audit.issues['invalid-serialization'] ?? 0) + 1
    }
  }
  if (conflict || audit.rejected) {
    return { status: 'blocked', reason: conflict ? 'contradictory-attempt' : 'invalid-attempt', count: records.length, audit }
  }
  const events = [...immutable.values()].sort(
    (left, right) =>
      left.timeStamp - right.timeStamp || (left.attemptId! < right.attemptId! ? -1 : left.attemptId! > right.attemptId! ? 1 : 0),
  )
  return { status: 'ready', count: events.length, events, audit }
}
