import type { IReviewWordState } from './types'
import type { IWordRecord } from '@/utils/db/record'

/**
 * Conservative repair for an interrupted or pre-fix mobile Review commit.
 * Only modern eligible, durable review events can trigger FSRS replay here.
 * Negative or unverified training events never promote memory proficiency.
 */
export function needsFsrsProjectionRecovery(
  state: IReviewWordState,
  records: readonly IWordRecord[],
): boolean {
  const eligible = records.filter((row) =>
    row.sourceMode === 'learn' &&
    row.learnItemKind === 'review' &&
    row.reviewRatingDecision?.eligible === true,
  )
  if (eligible.length === 0) return false
  const newest = eligible.reduce(
    (max, row) => Math.max(max, row.timeStamp),
    0,
  )
  return eligible.length > state.reviewCount ||
    newest > (state.lastReviewedAt ?? 0)
}
