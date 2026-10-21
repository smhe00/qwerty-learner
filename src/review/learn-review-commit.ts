/**
 * The same post-record FSRS-6 projection path for desktop spelling and
 * touch recall. The immutable WordRecord is the authority; ReviewWordState
 * is a tracked, replayable projection, never a second independent grade.
 *
 * Scheduled async by design: a saved word must be allowed to finish even
 * if the derived projection is temporarily unavailable. Learn preparation
 * flushes this queue and the full history remains available for rebuild.
 */
import { trackLearnPersistence } from '@/learn/persistence'
import type { LearnItemKind } from '@/learn/session'
import { applyReviewOutcome } from './repository'
import type { RatingDecision } from './state-machine'
import { getUTCUnixTimestamp } from '@/utils/time'

export function scheduleLearnReviewCommit(input: {
  dict: string
  word: string
  itemKind: LearnItemKind | undefined
  wordRecordId: number
  decision: RatingDecision | undefined
}): void {
  if (
    input.itemKind !== 'review' ||
    input.wordRecordId <= 0 ||
    input.decision?.eligible !== true
  ) return

  void trackLearnPersistence(
    applyReviewOutcome(
      input.dict,
      input.word,
      input.decision.rating,
      getUTCUnixTimestamp(),
      input.wordRecordId,
    ),
  ).catch((error) => {
    // Failure does not fabricate a successful projection; the raw event
    // remains durable and can be replayed/reconciled.
    console.error('failed to persist derived review scheduler state', error)
  })
}
