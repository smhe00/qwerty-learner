/** Immutable, origin-independent identity for new Learn/Review sessions.
 * Legacy sessions retain missing IDs; never infer a UUID from timestamp or Dexie ID. */
import { isLearningAttemptId, newLearningAttemptId } from './attempt-identity'

export const newReviewSessionId = (): string => newLearningAttemptId()
export const isReviewSessionId = (value: unknown): value is string =>
  isLearningAttemptId(value)
