import type { IWordRecord } from '@/utils/db/record'

/**
 * Mobile P0 before pre-reveal rating asked learners to grade memory AFTER
 * seeing the English answer. It wrongly labelled the event as if the
 * assessment had been committed before reveal.
 *
 * Keep historical evidence, but never promote legacy post-reveal positive
 * judgments to long-term FSRS or Acquisition admission.
 */
export function isLegacyMobilePostRevealEvidence(
  record: Pick<IWordRecord, 'reviewEvidence'>,
): boolean {
  const reasons = record.reviewEvidence?.reasonCodes
  // The pre-fix flaw affected only post-reveal *self-rated recall*.
  // Objective phone spelling is a distinct modern evidence method and must
  // never be suppressed by this compatibility filter.
  return reasons?.includes('mobile-multidimensional-learning') === true &&
    (reasons.includes('mobile-task-recall') ||
      reasons.includes('recall-committed-before-answer-reveal')) &&
    !reasons.includes('self-rated-before-answer-reveal')
}

export function isUnverifiedLegacyMobilePositiveReview(
  record: Pick<IWordRecord, 'reviewEvidence' | 'reviewRatingDecision'>,
): boolean {
  return isLegacyMobilePostRevealEvidence(record) &&
    record.reviewRatingDecision?.eligible === true &&
    record.reviewRatingDecision.rating !== 'again'
}
