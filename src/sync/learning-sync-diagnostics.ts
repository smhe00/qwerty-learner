/** Diagnostic-package data only. No credentials, row contents or identity fields. */
import { EVENT_RECORD_ISSUES } from './learning-event-compatibility'
import type { EventCompatibilityAudit } from './learning-event-compatibility'
import { isV4FailureCode } from './v4-failure-diagnostics'

export const SYNC_PENDING_NOTICE = '部分学习记录暂未同步，已保存在本机，可以继续学习。'
const KEY = 'qwerty.learning-sync-diagnostics.v1'
const STAGES = ['m3-recovery', 'm3-publication', 'm3-witness', 'm4-adoption', 'v4-check'] as const
const STATUSES = [
  'ready',
  'blocked',
  'idle',
  'uploaded-events-only',
  'skipped',
  'adopted',
  'candidate',
  'noop',
  'pushed',
  'pull-reload-required',
  'conflict',
  'failed',
  'disabled',
  'offline',
] as const
const CODES = new Set([
  'witness-local-invalid-attempt',
  'witness-local-contradictory-attempt',
  'witness-local-unbounded-scan',
  'witness-projection-identity-conflict',
  'witness-projection-invalid-event',
  'witness-projection-fsrs-replay-failed',
  'witness-server-unverified',
  'witness-receipt-integrity',
  'witness-predecessor-integrity',
  'witness-event-not-canonical',
  'witness-attempt-identity-conflict',
  'witness-evidence-digest-mismatch',
  'witnessed-device-fork',
  'witness-read-budget',
  'invalid-witness-set',
  'none',
  'unknown',
  'invalid-attempt',
  'contradictory-attempt',
  'unbounded-scan',
  'outbox-recovery-invalid-attempt',
  'outbox-recovery-legacy-or-corrupt-attempt',
  'outbox-recovery-contradictory-attempt',
  'outbox-recovery-unbounded-scan',
  'outbox-contradictory-attempt',
  'pilot-auth-required',
  'pilot-account-not-mounted',
  'pilot-owner-changed',
  'outbox-recovery-owner-changed',
  'outbox-recovery-workspace-owner-mismatch',
  'outbox-owner-changed-during-upload',
  'outbox-readback-integrity-mismatch',
  'm4-prefix-invalid-local-attempt',
  'm4-prefix-conflicting-local-attempt',
  'm4-prefix-conflicting-server-attempt',
  'm4-prefix-duplicate-local-attempt',
  'm4-prefix-manual-exclusion-needs-arbitration',
  'm4-prefix-state-extension-needs-arbitration',
  'm4-prefix-export-live-payload-mismatch',
  'all-witnessed-attempts-already-local',
  'verified-prefix-already-local',
  'no-complete-observed-prefix:no-observed-device-heads',
  'M3-witness-evidence-unverified',
])
type Entry = {
  stage: (typeof STAGES)[number]
  status: (typeof STATUSES)[number]
  code?: string
  audit?: EventCompatibilityAudit
  retainedLegacyStates?: number
}
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 10_000_000
function safeCode(code: unknown): string {
  if (typeof code !== 'string') return 'none'
  const unwrapped = code.replace(/^(m3-publication|M4-prefix-candidate):/, '')
  if (CODES.has(code) || isV4FailureCode(code)) return code
  return CODES.has(unwrapped) ? unwrapped : 'unknown'
}
function safeAudit(value: unknown): EventCompatibilityAudit | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as EventCompatibilityAudit
  if (![input.scanned, input.eligible, input.snapshotOnly, input.rejected].every(count)) return undefined
  const issues: EventCompatibilityAudit['issues'] = {}
  for (const key of EVENT_RECORD_ISSUES) if (count(input.issues?.[key])) issues[key] = input.issues[key]
  return { scanned: input.scanned, eligible: input.eligible, snapshotOnly: input.snapshotOnly, rejected: input.rejected, issues }
}
function cleanEntry(value: unknown): Entry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Entry
  if (!STAGES.includes(input.stage) || !STATUSES.includes(input.status)) return undefined
  const result: Entry = { stage: input.stage, status: input.status, code: safeCode(input.code) }
  const audit = safeAudit(input.audit)
  if (audit) result.audit = audit
  if (count(input.retainedLegacyStates)) result.retainedLegacyStates = input.retainedLegacyStates
  return result
}
export function readLearningSyncDiagnostics(): { version: 1; entries: Entry[] } {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) || '[]')
    const entries = Array.isArray(parsed)
      ? parsed
          .slice(-64)
          .map(cleanEntry)
          .filter((x): x is Entry => !!x)
      : []
    return { version: 1, entries }
  } catch {
    return { version: 1, entries: [] }
  }
}
export function recordLearningSyncDiagnostic(value: Entry): void {
  try {
    const entry = cleanEntry(value)
    if (!entry) return
    const entries = readLearningSyncDiagnostics().entries.slice(-63)
    entries.push(entry)
    sessionStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* Diagnostic persistence can never alter sync or authentication. */
  }
}
