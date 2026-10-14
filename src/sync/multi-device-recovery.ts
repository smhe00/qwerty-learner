/**
 * M3.7 recovery scan plan for a crash between Dexie word-record commit and
 * durable event-Outbox staging. This module is pure and never writes cloud.
 * Legacy/malformed evidence fails closed instead of inventing attempt IDs.
 */
import type { IWordRecord } from '@/utils/db/record'
import { immutableAttempt } from './multi-device-outbox'
import { stableWorkspaceJson } from './workspace-v4'

export type RecoveryScanResult =
  | { status: 'blocked'; reason: 'legacy-or-corrupt-attempt' |
      'contradictory-attempt' | 'unbounded-scan'; count: number }
  | { status: 'ready'; count: number; events: IWordRecord[] }

export function planOutboxRecovery(
  records: readonly IWordRecord[],
  maxRecords = 50_000,
): RecoveryScanResult {
  if (records.length > maxRecords || maxRecords < 1) {
    return { status: 'blocked', reason: 'unbounded-scan', count: records.length }
  }
  const immutable = new Map<string, IWordRecord>()
  for (const record of records) {
    let evidence: IWordRecord
    try { evidence = immutableAttempt(record) } catch {
      return { status: 'blocked', reason: 'legacy-or-corrupt-attempt',
        count: records.length }
    }
    const earlier = immutable.get(evidence.attemptId!)
    if (earlier && stableWorkspaceJson(earlier) !== stableWorkspaceJson(evidence)) {
      return { status: 'blocked', reason: 'contradictory-attempt',
        count: records.length }
    }
    immutable.set(evidence.attemptId!, earlier ?? evidence)
  }
  const events = [...immutable.values()].sort((left, right) =>
    left.timeStamp - right.timeStamp ||
    (left.attemptId! < right.attemptId! ? -1 :
      left.attemptId! > right.attemptId! ? 1 : 0))
  return { status: 'ready', count: events.length, events }
}
