/**
 * M2 per-word conflict isolation + opt-in same-base FSRS arbitration.
 *
 * This projects independent vocabulary without forcing one conflicting
 * review to block an entire account. Results are NOT a restorable V4 or
 * permission to publish. All raw attempts remain immutable evidence.
 *
 * Same-base arbitration requires BOTH review attempts to declare an
 * independently validated, pre-probe FSRS state fingerprint. It is only a
 * deterministic proposal until the fingerprint is written at the actual
 * probe boundary and a device-bound event chain validates each attempt.
 */
import { rebuildActiveFsrsStateFromWordRecords } from '@/review/fsrs/active'
import type { IReviewWordState } from '@/review/types'
import type { IWordRecord } from '@/utils/db/record'
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import { preflightAttemptIdentity } from './v4-merge-preflight'
import { projectUuidLearningConvergence } from './v4-event-convergence'

const SHA = /^[a-f0-9]{64}$/
const WINDOW = 60
const rank = { again: 0, hard: 1, good: 2, easy: 3 } as const
const keyOf = (row: IWordRecord) => JSON.stringify([row.dict, row.word])
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const eligibleReview = (r: IWordRecord) =>
  r.chapter === -1 && r.sourceMode !== 'typing' &&
  r.learnItemKind !== 'acquisition' && r.learnItemKind !== 'practice' &&
  r.reviewRatingDecision?.eligible === true

export type ScopedWordPreview = {
  dict: string
  word: string
  status: 'projected' | 'quarantined'
  reason: string
  /** Every original immutable UUID remains available for audit. */
  attemptIds: string[]
  /** No durable WordRecord is rewritten. Scheduler ignores losing grade ONLY in projection. */
  suppressedRatingAttemptIds: string[]
  fsrsState: IReviewWordState | null
}
export type ScopedAccountPreview = {
  status: 'projected' | 'partial' | 'blocked'
  publishReady: false
  convergenceComplete: false
  reason: string
  words: ScopedWordPreview[]
  stats: {
    projectedWords: number
    quarantinedWords: number
    uniqueAttempts: number
    suppressedDuplicateGrades: number
  }
}
function result(words: ScopedWordPreview[], reason = 'none'): ScopedAccountPreview {
  words.sort((a, b) => compare(a.dict, b.dict) || compare(a.word, b.word))
  const good = words.filter(w => w.status === 'projected').length
  const bad = words.length - good
  return {
    status: bad === 0 ? 'projected' : good > 0 ? 'partial' : 'blocked',
    publishReady: false, convergenceComplete: false,
    reason,
    words,
    stats: { projectedWords: good, quarantinedWords: bad,
      uniqueAttempts: new Set(words.flatMap(w => w.attemptIds)).size,
      suppressedDuplicateGrades: words.reduce((n, w) =>
        n + w.suppressedRatingAttemptIds.length, 0) },
  }
}
function quarantine(rows: readonly IWordRecord[], why: string): ScopedWordPreview {
  return { dict: rows[0].dict, word: rows[0].word,
    status: 'quarantined', reason: why,
    attemptIds: [...new Set(rows.map(r => r.attemptId).filter(
      (id): id is string => typeof id === 'string'))].sort(),
    suppressedRatingAttemptIds: [], fsrsState: null }
}

/** Return the *only* safe duplicate pair: one unique reviewed word attempt
 * per origin, both based on an explicit equal FSRS state digest.
 * Never infer same rounds from timestamps alone. */
function duplicateSameBase(
  local: readonly IWordRecord[],
  remote: readonly IWordRecord[],
): { winning: string; suppressed: string } | null {
  const localIds = new Set(local.map(x => x.attemptId))
  const remoteIds = new Set(remote.map(x => x.attemptId))
  const left = local.filter(r => eligibleReview(r) && !remoteIds.has(r.attemptId))
  const right = remote.filter(r => eligibleReview(r) && !localIds.has(r.attemptId))
  if (left.length !== 1 || right.length !== 1) return null
  const a = left[0], b = right[0]
  const fingerprint = a.reviewBaseStateFingerprint
  if (!fingerprint || !SHA.test(fingerprint) ||
      b.reviewBaseStateFingerprint !== fingerprint ||
      !a.attemptId || !b.attemptId || a.attemptId === b.attemptId) return null
  // If any third rating references this same base, a 2-way tie breaker
  // would erase an unknown conflicting grade: quarantine instead.
  const all = new Map<string, IWordRecord>()
  for (const r of [...local, ...remote]) {
    if (r.attemptId && !all.has(r.attemptId)) all.set(r.attemptId, r)
  }
  if ([...all.values()].filter(r => eligibleReview(r) &&
    r.reviewBaseStateFingerprint === fingerprint).length !== 2) return null
  const ar = rank[a.reviewRatingDecision!.rating!]
  const br = rank[b.reviewRatingDecision!.rating!]
  const aWins = ar < br || (ar === br && a.attemptId < b.attemptId)
  return { winning: aWins ? a.attemptId : b.attemptId,
    suppressed: aWins ? b.attemptId : a.attemptId }
}
function sameBaseCollision(records: readonly IWordRecord[]): boolean {
  const seen = new Map<string, string>()
  for (const r of records) {
    if (!eligibleReview(r) || !r.attemptId ||
        !r.reviewBaseStateFingerprint || !SHA.test(r.reviewBaseStateFingerprint)) continue
    const prev = seen.get(r.reviewBaseStateFingerprint)
    if (prev && prev !== r.attemptId) return true
    seen.set(r.reviewBaseStateFingerprint, r.attemptId)
  }
  return false
}
/** A word's multiple independent candidates must never each change FSRS
 * when they could be two grades of the same scheduled Review. */
function ambiguity(local: readonly IWordRecord[], remote: readonly IWordRecord[]): boolean {
  const localIds = new Set(local.map(r => r.attemptId))
  const remoteIds = new Set(remote.map(r => r.attemptId))
  const a = local.filter(r => eligibleReview(r) && !remoteIds.has(r.attemptId))
  const b = remote.filter(r => eligibleReview(r) && !localIds.has(r.attemptId))
  for (const l of a) for (const r of b) {
    if (Math.abs(l.timeStamp - r.timeStamp) <= WINDOW ||
        (SHA.test(l.reviewBaseStateFingerprint ?? '') &&
          l.reviewBaseStateFingerprint === r.reviewBaseStateFingerprint)) return true
  }
  return false
}

/**
 * A malformed UUID reused for contradictory words is account-wide unsafe.
 * Other per-word conflicts are isolated and independent words still project.
 * There is NO write path, and no acceptance of missing legacy ancestry.
 */
export function projectWordScopedConvergence(input: {
  local: readonly IWordRecord[]
  remote: readonly IWordRecord[]
}): ScopedAccountPreview {
  const preflight = preflightAttemptIdentity(input)
  if (preflight.identityConflicts) return result([], 'global-uuid-identity-conflict')
  const groups = new Map<string, { local: IWordRecord[]; remote: IWordRecord[] }>()
  for (const origin of ['local', 'remote'] as const) {
    for (const row of input[origin]) {
      if (!row || typeof row.dict !== 'string' || !row.dict ||
          typeof row.word !== 'string' || !row.word) {
        return result([], 'invalid-word-identity')
      }
      const key = keyOf(row)
      const group = groups.get(key) ?? { local: [], remote: [] }
      group[origin].push(row)
      groups.set(key, group)
    }
  }
  const words: ScopedWordPreview[] = []
  for (const { local, remote } of groups.values()) {
    const both = [...local, ...remote]
    if (both.some(r => !isLearningAttemptId(r.attemptId))) {
      words.push(quarantine(both, 'legacy-or-unknown-attempt'))
      continue
    }
    const original = projectUuidLearningConvergence({ local, remote })
    const collision = sameBaseCollision(both)
    const competing = ambiguity(local, remote)
    const pair = competing || collision ? duplicateSameBase(local, remote) : null
    if ((competing || collision) && !pair) {
      words.push(quarantine(both, 'unverified-concurrent-fsrs-review'))
      continue
    }
    if (original.status !== 'projected' &&
        !(original.reason === 'concurrent-review-conflict' && pair)) {
      words.push(quarantine(both, original.reason))
      continue
    }
    if (pair) {
      // Keep both raw immutable events unchanged. The losing score is
      // ineligible in an ephemeral copy used ONLY by FSRS replay.
      const unique = new Map<string, IWordRecord>()
      for (const row of both) if (row.attemptId && !unique.has(row.attemptId)) {
        unique.set(row.attemptId, row)
      }
      const rows = [...unique.values()].sort((a, b) =>
        a.timeStamp - b.timeStamp || compare(a.attemptId!, b.attemptId!))
      const shadow = rows.map((row, i) => ({
        ...row, id: i + 1,
        ...(row.attemptId === pair.suppressed
          ? { reviewRatingDecision: {
              eligible: false as const,
              rating: null,
              reason: 'non-cold-attempt' as const,
              reasonCodes: ['duplicate-same-fsrs-base-preview-only'],
            } } : {}),
      }))
      try {
        const state = rebuildActiveFsrsStateFromWordRecords(
          rows[0].dict, rows[0].word, shadow) ?? null
        words.push({ dict: rows[0].dict, word: rows[0].word,
          status: 'projected', reason: 'same-base-duplicate-preview-only',
          attemptIds: rows.map(r => r.attemptId!), fsrsState: state,
          suppressedRatingAttemptIds: [pair.suppressed] })
      } catch {
        words.push(quarantine(both, 'fsrs-replay-failed'))
      }
      continue
    }
    const word = original.words[0]
    words.push({ dict: word.dict, word: word.word, status: 'projected',
      reason: 'none', attemptIds: [...word.attemptIds],
      fsrsState: word.fsrsState, suppressedRatingAttemptIds: [] })
  }
  return result(words)
}
