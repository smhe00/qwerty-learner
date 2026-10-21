/**
 * Stable SHA-256 of the actual durable FSRS-6 state sampled before a
 * long-term Review probe. Not a timestamp or session-derived heuristic.
 *
 * Excludes only origin-local auto-increment ID. Includes lifecycle and
 * scheduling parameters so a stale state never aliases a newer round.
 * This is evidence of the client's local state, not remote attestation.
 */
import type { IReviewWordState } from '@/review/types'
import { sha256Hex } from '@/sync/sha256-compat'
import { stableWorkspaceJson } from '@/sync/workspace-v4'

export async function fingerprintReviewBaseState(
  state: IReviewWordState,
): Promise<string | null> {
  if (!state || state.schedulerState.kind !== 'fsrs6' ||
      state.lifecycle === 'excluded' || state.exclusion ||
      typeof state.dict !== 'string' || !state.dict ||
      typeof state.word !== 'string' || !state.word) return null
  const { id: _localId, ...durable } = state
  const encoded = new TextEncoder().encode(stableWorkspaceJson({
    version: 1, kind: 'review-base-fsrs6', state: durable,
  }))
  return sha256Hex(encoded)
}
