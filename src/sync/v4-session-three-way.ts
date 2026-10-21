/**
 * M2.6: read-only, deterministic three-way Review Session conflict classifier.
 *
 * A pinned SHA-256 detects bytes changing since an EXTERNALLY authenticated
 * common-ancestor snapshot. It cannot authenticate its own origin: callers
 * must verify account ownership, exact V4 ancestor provenance and a complete
 * per-device snapshot BEFORE supplying the trusted pinned digest.
 *
 * This is intentionally NOT a V4 restore artifact. Nothing here writes IDB,
 * creates a session, updates V4, advances FSRS or authorizes cloud publication.
 */
import type { IReviewRecord } from '@/utils/db/record'
import { isReviewSessionId } from '@/utils/db/review-session-identity'
import { sha256Hex } from './sha256-compat'
import { stableWorkspaceJson } from './workspace-v4'

type Session = IReviewRecord & { sessionId: string; id: number }
type Selected = {
  sessionId: string
  /** Only previews an origin; not permission to overwrite another device. */
  selectedFrom: 'local' | 'remote' | 'identical'
  record: IReviewRecord
}

export type ThreeWayReviewSessionPreview =
  | { status: 'blocked'; publishReady: false; convergenceComplete: false;
      reason: string; sessions: [] }
  | { status: 'projected'; publishReady: false; convergenceComplete: false;
      reason: 'verified-by-caller-ancestor-candidate-only'
      sessions: Selected[]
      counts: { unchanged: number; localAdvance: number; remoteAdvance: number;
        identicalAdvance: number; localNew: number; remoteNew: number;
        identicalNew: number }
    }

const SHA = /^[0-9a-f]{64}$/
const fail = (reason: string): ThreeWayReviewSessionPreview =>
  ({ status: 'blocked', publishReady: false, convergenceComplete: false,
    reason, sessions: [] })

function validate(rows: readonly IReviewRecord[]): Map<string, Session> {
  const result = new Map<string, Session>()
  const numericIds = new Set<number>()
  for (const row of rows) {
    if (!isReviewSessionId(row.sessionId) ||
        !Number.isSafeInteger(row.id) || (row.id ?? 0) < 1 ||
        numericIds.has(row.id!) ||
        typeof row.dict !== 'string' || row.dict.length === 0 ||
        !Number.isSafeInteger(row.createTime) || row.createTime < 0 ||
        !Number.isSafeInteger(row.index) || row.index < 0 ||
        !Array.isArray(row.words) ||
        (row.index > row.words.length &&
          !(row.isFinished === true && row.words.length === 0)) ||
        typeof row.isFinished !== 'boolean' ||
        result.has(row.sessionId)) {
      throw new Error('invalid-or-legacy-session')
    }
    const session = row as Session
    numericIds.add(session.id)
    result.set(session.sessionId, session)
  }
  return result
}

function logical(row: Session): string {
  // Auto-increment IDs are origin-local, even when equal by coincidence.
  const { id: _originLocalPrimaryKey, ...rest } = row
  return stableWorkspaceJson(rest)
}

/** Canonical digest is independent of Dexie local IDs and row order.
 * An independently pinned expected hash must be supplied to the classifier. */
export async function digestThreeWayReviewSessionAncestor(
  sessions: readonly IReviewRecord[],
): Promise<string> {
  const indexed = validate(sessions)
  const payload = [...indexed.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0).map(([uuid, row]) => [uuid, logical(row)])
  return sha256Hex(new TextEncoder().encode(stableWorkspaceJson(payload)))
}

function assertEvolution(base: Session, next: Session): void {
  if (base.dict !== next.dict || base.createTime !== next.createTime ||
      base.sessionKind !== next.sessionKind) {
    throw new Error('session-immutable-header-changed')
  }
  if (base.isFinished && logical(base) !== logical(next)) {
    throw new Error('terminal-session-mutated')
  }
  if (next.index < base.index ||
      (base.isFinished && !next.isFinished)) {
    throw new Error('session-cursor-regression')
  }
}

/**
 * Candidate ONLY: provenance, S1 ownership, complete heads and rollback
 * transaction are all outside this helper. An equal digest of caller-provided
 * data is NOT proof that the ancestor was genuinely shared by both devices.
 *
 * An ancestral row missing from either side blocks (absence may be an
 * incomplete Blob list, never an implicit deletion). Both divergent changes
 * block; no timestamp / max(index) / last-write-wins heuristic.
 */
export async function inspectThreeWayReviewSessions(input: {
  ancestor: readonly IReviewRecord[]
  /** SHA-256 from a separately authenticated, pinned common-ancestor V4. */
  pinnedAncestorDigest: string
  local: readonly IReviewRecord[]
  remote: readonly IReviewRecord[]
}): Promise<ThreeWayReviewSessionPreview> {
  try {
    if (!SHA.test(input.pinnedAncestorDigest)) {
      return fail('unverified-ancestor-digest')
    }
    const actual = await digestThreeWayReviewSessionAncestor(input.ancestor)
    if (actual !== input.pinnedAncestorDigest) {
      return fail('ancestor-digest-mismatch')
    }
    const base = validate(input.ancestor)
    const left = validate(input.local)
    const right = validate(input.remote)
    const all = [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].sort()
    const sessions: Selected[] = []
    const counts = { unchanged: 0, localAdvance: 0, remoteAdvance: 0,
      identicalAdvance: 0, localNew: 0, remoteNew: 0, identicalNew: 0 }
    for (const sessionId of all) {
      const ancestor = base.get(sessionId)
      const local = left.get(sessionId)
      const remote = right.get(sessionId)
      if (ancestor && (!local || !remote)) {
        return fail('ancestral-session-missing-on-device')
      }
      if (!local && !remote) continue
      // Independently created, stable UUID sessions may exist on just one
      // device. Historical UUID-less rows are rejected by validate().
      if (ancestor && local && remote) {
        // Check pinned ancestry before cross-device equality to distinguish
        // a broken immutable header from a genuine two-device conflict.
        assertEvolution(ancestor, local)
        assertEvolution(ancestor, remote)
      }
      if (local && remote &&
          (local.dict !== remote.dict || local.createTime !== remote.createTime ||
           local.sessionKind !== remote.sessionKind)) {
        return fail('session-immutable-header-conflict')
      }
      const a = ancestor ? logical(ancestor) : undefined
      const l = local ? logical(local) : undefined
      const r = remote ? logical(remote) : undefined
      let selected: Session
      let selectedFrom: Selected['selectedFrom']
      if (!ancestor) {
        if (local && remote) {
          if (l !== r) return fail('concurrent-new-session-conflict')
          selected = local
          selectedFrom = 'identical'
          counts.identicalNew++
        } else if (local) {
          selected = local
          selectedFrom = 'local'
          counts.localNew++
        } else {
          selected = remote!
          selectedFrom = 'remote'
          counts.remoteNew++
        }
      } else if (l === r) {
        selected = local!
        selectedFrom = 'identical'
        if (l === a) counts.unchanged++
        else counts.identicalAdvance++
      } else if (l === a) {
        selected = remote!
        selectedFrom = 'remote'
        counts.remoteAdvance++
      } else if (r === a) {
        selected = local!
        selectedFrom = 'local'
        counts.localAdvance++
      } else {
        return fail('concurrent-session-advance-conflict')
      }
      // Return a deep copy, stripped of the origin-local numeric key.
      const { id: _localId, ...logicalSession } =
        structuredClone(selected) as Session
      sessions.push({ sessionId, selectedFrom, record: logicalSession })
    }
    return { status: 'projected', publishReady: false,
      convergenceComplete: false,
      reason: 'verified-by-caller-ancestor-candidate-only', sessions, counts }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'invalid-session-projection')
  }
}
