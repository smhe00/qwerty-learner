/**
 * M2 read-only per-word learning evidence projection.
 *
 * This is NOT a six-table V4 merge and cannot authorize uploading. It
 * deliberately excludes legacy rows until common-ancestor rekeying exists.
 * IDs used to replay FSRS here are synthetic and MUST NOT be written to Dexie.
 */
import { rebuildActiveFsrsStateFromWordRecords } from '@/review/fsrs/active'
import type { IReviewWordState } from '@/review/types'
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IWordRecord } from '@/utils/db/record'
import { preflightAttemptIdentity } from './v4-merge-preflight'

type ProjectedWord = {
  dict: string
  word: string
  attemptIds: string[]
  /** Derived from complete eligible, admitted Learn history only. */
  fsrsState: IReviewWordState | null
}

export type EventConvergenceProjection = {
  status: 'projected' | 'blocked'
  /** Always false: full 6-table / clock / journal / cloud proof is absent. */
  publishReady: false
  reason: 'none' | 'identity-conflict' | 'legacy-unverified' |
    'invalid-event' | 'fsrs-replay-failed'
  sharedAttempts: number
  uniqueAttempts: number
  words: ProjectedWord[]
}

function ordered(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validAttempt(row: IWordRecord): row is IWordRecord & { attemptId: string } {
  return isLearningAttemptId(row.attemptId) &&
    typeof row.dict === 'string' && row.dict.length > 0 &&
    typeof row.word === 'string' && row.word.length > 0 &&
    Number.isSafeInteger(row.timeStamp) && row.timeStamp >= 0 &&
    row.timeStamp <= 8_640_000_000_000
}

function blocked(
  reason: Exclude<EventConvergenceProjection['reason'], 'none'>,
): EventConvergenceProjection {
  return { status: 'blocked', publishReady: false, reason,
    sharedAttempts: 0, uniqueAttempts: 0, words: [] }
}

/** Pure projection: never mutates source rows, numeric IDs or V4 snapshots. */
export function projectUuidLearningConvergence(input: {
  local: readonly IWordRecord[]
  remote: readonly IWordRecord[]
}): EventConvergenceProjection {
  const identity = preflightAttemptIdentity(input)
  if (identity.identityConflicts > 0) return blocked('identity-conflict')
  if (!identity.safeEventIdentity ||
      input.local.some(row => !row.attemptId) ||
      input.remote.some(row => !row.attemptId)) {
    return blocked('legacy-unverified')
  }
  if (!input.local.every(validAttempt) || !input.remote.every(validAttempt)) {
    return blocked('invalid-event')
  }

  const unique = new Map<string, IWordRecord & { attemptId: string }>()
  for (const row of [...input.local, ...input.remote]) {
    // Immutable primary evidence was verified by preflight; derived shadow
    // snapshots are ignored, so either equivalent copy can represent the event.
    unique.set(row.attemptId, unique.get(row.attemptId) ?? row)
  }

  // JSON string encoding makes (dict,word) an unambiguous tuple key even
  // when arbitrary dictionary or word strings contain delimiter characters.
  const groups = new Map<string, (IWordRecord & { attemptId: string })[]>()
  for (const row of unique.values()) {
    const key = JSON.stringify([row.dict, row.word])
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const words: ProjectedWord[] = []
  try {
    for (const rows of groups.values()) {
      rows.sort((a, b) => a.timeStamp - b.timeStamp ||
        ordered(a.attemptId, b.attemptId))
      // The existing FSRS rebuild sorts (timestamp, numeric ID). Allocate
      // ephemeral stable IDs ONLY inside this throwaway in-memory projection.
      const ephemeral = rows.map((row, index) => ({ ...row, id: index + 1 }))
      const { dict, word } = rows[0]
      const fsrsState = rebuildActiveFsrsStateFromWordRecords(
        dict, word, ephemeral,
      ) ?? null
      words.push({ dict, word, attemptIds: rows.map(r => r.attemptId),
        fsrsState })
    }
  } catch {
    return blocked('fsrs-replay-failed')
  }
  words.sort((a, b) => ordered(a.dict, b.dict) || ordered(a.word, b.word))
  return { status: 'projected', publishReady: false, reason: 'none',
    sharedAttempts: identity.shared, uniqueAttempts: unique.size, words }
}
