import type { ExerciseConditionV1 } from './condition'
import type { ReviewPolicyDecisionV1 } from './decision'
import type {
  IWordRecord,
  LearningContextV1,
  LetterMistakes,
  WordRecordTelemetry,
} from '@/utils/db/record'

export const REVIEW_OBSERVATION_VERSION = 1 as const

export type ReviewObservation = {
  version: typeof REVIEW_OBSERVATION_VERSION
  recordId?: number
  word: string
  dict: string
  timeStamp: number
  wrongCount: number
  mistakes: LetterMistakes
  typingTelemetry?: WordRecordTelemetry
  learningContext?: LearningContextV1
  exerciseCondition?: ExerciseConditionV1
  reviewPolicyDecision?: ReviewPolicyDecisionV1
}

function cloneMistakes(mistakes: LetterMistakes): LetterMistakes {
  return Object.fromEntries(
    Object.entries(mistakes).map(([index, wrongKeys]) => [Number(index), [...wrongKeys]]),
  )
}

/**
 * Creates the raw algorithm input from a persisted WordRecord.
 *
 * Missing adaptive fields are deliberately preserved as unknown so legacy
 * records remain valid inputs to later evidence/profile rebuilds.
 */
export function buildReviewObservation(record: IWordRecord): ReviewObservation {
  return {
    version: REVIEW_OBSERVATION_VERSION,
    recordId: record.id,
    word: record.word,
    dict: record.dict,
    timeStamp: record.timeStamp,
    wrongCount: record.wrongCount,
    mistakes: cloneMistakes(record.mistakes),
    typingTelemetry: record.typingTelemetry,
    learningContext: record.learningContext,
    exerciseCondition: record.exerciseCondition,
    reviewPolicyDecision: record.reviewPolicyDecision,
  }
}
