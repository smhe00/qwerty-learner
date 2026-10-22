/**
 * M2 word-scoped convergence: all independent learning events are retained.
 *
 * Cross-device reviews are NOT deduplicated by time windows, identical FSRS
 * base fingerprints, or an Again-first heuristic. Only immutable attemptId
 * identifies a retransmission. FSRS is replayed in (timestamp, attemptId)
 * order. A corrupt single word is quarantined without stopping unrelated
 * vocabulary. This is an evidence PREVIEW, never a six-table/cloud write.
 */
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IWordRecord } from '@/utils/db/record'
import type { IReviewWordState } from '@/review/types'
import { preflightAttemptIdentity } from './v4-merge-preflight'
import { projectUuidLearningConvergence } from './v4-event-convergence'

export type ScopedWordPreview = {
  dict: string
  word: string
  status: 'projected' | 'quarantined'
  reason: string
  attemptIds: string[]
  /** Always empty under the time-ordered, never-suppress-real-study rule. */
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
const keyOf = (r: IWordRecord) => JSON.stringify([r.dict, r.word])
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
function report(words: ScopedWordPreview[], reason = 'none'): ScopedAccountPreview {
  words.sort((a, b) => cmp(a.dict, b.dict) || cmp(a.word, b.word))
  const good = words.filter(w => w.status === 'projected').length
  const bad = words.length - good
  return {
    status: reason !== 'none' || words.length === 0 ? 'blocked' :
      bad === 0 ? 'projected' : good ? 'partial' : 'blocked',
    publishReady: false, convergenceComplete: false, reason, words,
    stats: { projectedWords: good, quarantinedWords: bad,
      uniqueAttempts: new Set(words.flatMap(w => w.attemptIds)).size,
      suppressedDuplicateGrades: 0 },
  }
}
function quarantine(rows: readonly IWordRecord[], reason: string): ScopedWordPreview {
  return { dict: rows[0].dict, word: rows[0].word, status: 'quarantined',
    reason, attemptIds: [...new Set(rows.map(r => r.attemptId).filter(
      (id): id is string => typeof id === 'string'))].sort(),
    fsrsState: null, suppressedRatingAttemptIds: [] }
}
/** No data mutation, no guessing unknown pre-FSRS legacy evidence. */
export function projectWordScopedConvergence(input: {
  local: readonly IWordRecord[]
  remote: readonly IWordRecord[]
}): ScopedAccountPreview {
  const identity = preflightAttemptIdentity(input)
  if (identity.identityConflicts) return report([], 'global-uuid-identity-conflict')
  const groups = new Map<string, { local: IWordRecord[]; remote: IWordRecord[] }>()
  for (const origin of ['local', 'remote'] as const) {
    for (const row of input[origin]) {
      if (!row || typeof row.dict !== 'string' || !row.dict ||
          typeof row.word !== 'string' || !row.word) return report([], 'invalid-word-identity')
      const key = keyOf(row)
      const group = groups.get(key) ?? { local: [], remote: [] }
      group[origin].push(row)
      groups.set(key, group)
    }
  }
  const words: ScopedWordPreview[] = []
  for (const { local, remote } of groups.values()) {
    const rows = [...local, ...remote]
    if (rows.some(r => !isLearningAttemptId(r.attemptId))) {
      words.push(quarantine(rows, 'legacy-or-unknown-attempt'))
      continue
    }
    const replay = projectUuidLearningConvergence({ local, remote })
    if (replay.status !== 'projected' || replay.words.length !== 1) {
      words.push(quarantine(rows, replay.reason))
      continue
    }
    const item = replay.words[0]
    words.push({ ...item, status: 'projected', reason: 'none',
      suppressedRatingAttemptIds: [] })
  }
  return report(words)
}
