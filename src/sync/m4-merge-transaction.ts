/**
 * M4 crash-safe full V4 merge transaction kernel. NOT wired to app boot or
 * network. Caller must independently verify authenticated common ancestor,
 * six-table candidate, S1 owner and exclusive writer lock. This kernel never
 * establishes cloud convergence or authorizes an M2 read-only projection.
 */
import { assertRestorableWorkspaceV4, canonicalWorkspaceData,
  stableWorkspaceJson, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

const SHA = /^[a-f0-9]{64}$/
export type PendingM4Merge = {
  version: 1
  accountId: string
  registryGeneration: number
  originalFingerprint: string
  candidateFingerprint: string
  original: WorkspaceSnapshotV4
  candidate: WorkspaceSnapshotV4
}
export type M4Decision = 'apply' | 'rollback'
export type M4JournalPort = {
  read(): Promise<PendingM4Merge | null>
  /** Atomically stage BOTH entire snapshots with S1 generation CAS. */
  stage(pending: PendingM4Merge): Promise<void>
  /** Atomically remove journal with CAS; keep rollback archive. */
  finalize(pending: PendingM4Merge, decision: M4Decision): Promise<void>
}
export type M4ReplicaPort = {
  capture(accountId: string): Promise<WorkspaceSnapshotV4>
  restore(snapshot: WorkspaceSnapshotV4, accountId: string): Promise<void>
  seal(): Promise<void>
}
export type M4Phase = 'capture' | 'stage' | 'restore' | 'verify' |
  'seal' | 'finalize' | 'complete'
const notify = (fn: ((p: M4Phase) => void) | undefined, phase: M4Phase) => {
  try { fn?.(phase) } catch { /* UI must never interrupt recovery */ }
}
function assertOwner(snapshot: WorkspaceSnapshotV4, accountId: string): void {
  assertRestorableWorkspaceV4(snapshot)
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== accountId) {
    throw new Error('m4-account-owner-mismatch')
  }
}
export async function validatePendingM4Merge(p: PendingM4Merge): Promise<void> {
  if (p.version !== 1 || !p.accountId || p.accountId.trim() !== p.accountId ||
      !Number.isSafeInteger(p.registryGeneration) || p.registryGeneration < 1 ||
      !SHA.test(p.originalFingerprint) || !SHA.test(p.candidateFingerprint)) {
    throw new Error('m4-invalid-transaction-identity')
  }
  assertOwner(p.original, p.accountId)
  assertOwner(p.candidate, p.accountId)
  const [oldFingerprint, nextFingerprint] = await Promise.all([
    workspaceFingerprintV4(p.original), workspaceFingerprintV4(p.candidate),
  ])
  if (oldFingerprint !== p.originalFingerprint ||
      nextFingerprint !== p.candidateFingerprint) {
    throw new Error('m4-journal-fingerprint-mismatch')
  }
}
/**
 * Report ONLY a fixed-size structural category, never a row, key, word,
 * account identifier, timestamp or fingerprint. Fingerprints may compare
 * differently after a Typeson export/import cycle, but that is NOT authority
 * to accept changed durable learning records.
 */
/**
 * Compare the V4 exported WordRecord rows by their persistent numeric IDs.
 * Return ONLY constant schema-level diagnosis codes. The values and the IDs
 * themselves never leave this function or enter diagnostic logs.
 */
export function classifyM4WordRecordDifference(
  expected: WorkspaceSnapshotV4,
  actual: WorkspaceSnapshotV4,
): string {
  const records = (snapshot: WorkspaceSnapshotV4): unknown[] =>
    (((snapshot.workspaceData.database as {
      data: { data: Array<{ tableName: string; rows: unknown[] }> }
    }).data.data.find(g => g.tableName === 'wordRecords'))?.rows ?? [])
  const before = records(expected)
  const after = records(actual)
  if (before.length !== after.length) return 'row-count'
  const toMap = (arr: unknown[]) => {
    const result = new Map<number, Record<string, unknown>>()
    for (const value of arr) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) ||
          result.has(row.id)) return null
      result.set(row.id, row)
    }
    return result
  }
  const left = toMap(before), right = toMap(after)
  if (!left || !right) return 'invalid-ids'
  if ([...left.keys()].some(id => !right.has(id))) return 'row-ids'
  const known = new Set(['id', 'attemptId', 'word', 'dict',
    'chapter', 'timeStamp', 'wrongCount', 'mistakes', 'timing',
    'typingTelemetry', 'fsrsState', 'learnItemKind', 'sourceMode',
    'errorCount', 'trans', 'sourceRecordId', '$types'])
  for (const [id, row] of left) {
    const found = right.get(id)!
    if (stableWorkspaceJson(row) === stableWorkspaceJson(found)) continue
    const fields = [...new Set([...Object.keys(row), ...Object.keys(found)])].sort()
    const diff = fields.filter(key => {
      const a = row[key], b = found[key]
      return a === undefined || b === undefined ? a !== b :
        stableWorkspaceJson(a) !== stableWorkspaceJson(b)
    })
    if (!diff.length) return 'row-encoding'
    if (diff.length === 1 && diff[0] === '$types') return 'typeson-only'
    const first = diff[0]
    if (!known.has(first)) return 'field-other'
    if (first === '$types') return 'typeson-and-fields'
    // Lowercasing field names avoids exposing arbitrary source strings.
    return 'field-' + first.toLowerCase()
  }
  return 'row-order-or-group-metadata'
}

export function classifyM4ReadbackDifference(
  expected: WorkspaceSnapshotV4,
  actual: WorkspaceSnapshotV4,
): string {
  const before = canonicalWorkspaceData(expected.workspaceData) as Record<string, unknown>
  const after = canonicalWorkspaceData(actual.workspaceData) as Record<string, unknown>
  const differs = (a: unknown, b: unknown) =>
    a === undefined || b === undefined ? a !== b :
      stableWorkspaceJson(a) !== stableWorkspaceJson(b)
  if (differs(before.learnRuntime, after.learnRuntime)) return 'learnruntime'
  if (differs(before.settings, after.settings)) return 'settings'
  if (differs(before.navigation, after.navigation)) return 'navigation'
  const db1 = before.database as { tables?: unknown[]; data?: unknown[] }
  const db2 = after.database as { tables?: unknown[]; data?: unknown[] }
  if (differs(db1.tables, db2.tables)) return 'tablemanifest'
  if (Array.isArray(db1.data) && Array.isArray(db2.data)) {
    const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
      'reviewWordStates', 'achievementEvents', 'achievementStates']
    const groups = (value: unknown[]) => new Map(
      value.filter(x => x && typeof x === 'object' &&
        'tableName' in x).map(x => {
        const group = x as { tableName: string }
        return [group.tableName, x]
      }),
    )
    const a = groups(db1.data), b = groups(db2.data)
    for (const name of names) {
      if (differs(a.get(name), b.get(name))) {
        // Never concatenate an unknown table name into diagnostic output.
        return 'table-' + name.toLowerCase()
      }
    }
  }
  return 'databaseother'
}
async function verify(
  replica: M4ReplicaPort, accountId: string, expected: string,
  target: WorkspaceSnapshotV4,
) {
  const actual = await replica.capture(accountId)
  assertOwner(actual, accountId)
  if (await workspaceFingerprintV4(actual) !== expected) {
    const component = classifyM4ReadbackDifference(target, actual)
    const detail = component === 'table-wordrecords' ?
      ':' + classifyM4WordRecordDifference(target, actual) : ''
    throw new Error('m4-full-v4-readback-mismatch:' + component + detail)
  }
}
/**
 * Pre-mount recovery under exclusive S1 writer lock. Explicit rollback uses
 * the ORIGINAL full six-table snapshot, including sessions and settings.
 * On any error the durable journal is retained, never deleted implicitly.
 */
export async function recoverM4Merge(
  journal: M4JournalPort, replica: M4ReplicaPort, decision: M4Decision,
  observer?: (phase: M4Phase) => void,
): Promise<boolean> {
  if (decision !== 'apply' && decision !== 'rollback') {
    throw new Error('m4-invalid-recovery-decision')
  }
  const pending = await journal.read()
  if (!pending) return false
  await validatePendingM4Merge(pending)
  const target = decision === 'apply' ? pending.candidate : pending.original
  const fingerprint = decision === 'apply'
    ? pending.candidateFingerprint : pending.originalFingerprint
  notify(observer, 'restore')
  await replica.restore(target, pending.accountId)
  notify(observer, 'verify')
  await verify(replica, pending.accountId, fingerprint, target)
  notify(observer, 'seal')
  await replica.seal()
  notify(observer, 'finalize')
  await journal.finalize(pending, decision)
  notify(observer, 'complete')
  return true
}
/**
 * This is intentionally NOT called by Learn, M3 or boot.
 * Refuses stale original snapshots and stages rollback BEFORE restore.
 */
export async function executeM4Merge(
  journal: M4JournalPort, replica: M4ReplicaPort,
  input: {
    accountId: string
    registryGeneration: number
    expectedOriginalFingerprint: string
    candidate: WorkspaceSnapshotV4
  },
  observer?: (phase: M4Phase) => void,
): Promise<void> {
  if (await journal.read()) throw new Error('m4-previous-merge-must-recover-first')
  notify(observer, 'capture')
  const original = await replica.capture(input.accountId)
  assertOwner(original, input.accountId)
  const originalFingerprint = await workspaceFingerprintV4(original)
  if (!SHA.test(input.expectedOriginalFingerprint) ||
      input.expectedOriginalFingerprint !== originalFingerprint) {
    throw new Error('m4-stale-local-source-no-write')
  }
  const pending: PendingM4Merge = {
    version: 1, accountId: input.accountId,
    registryGeneration: input.registryGeneration,
    original, originalFingerprint, candidate: input.candidate,
    candidateFingerprint: await workspaceFingerprintV4(input.candidate),
  }
  await validatePendingM4Merge(pending)
  notify(observer, 'stage')
  await journal.stage(pending)
  try {
    if (!(await recoverM4Merge(journal, replica, 'apply', observer))) {
      throw new Error('m4-journal-vanished')
    }
  } catch (cause) {
    // Never discard journal or rewrite original on failure; explicit recovery
    // under S1 writer lease chooses idempotent replay or rollback.
    throw new Error('m4-merge-interrupted-recovery-required', { cause })
  }
}
