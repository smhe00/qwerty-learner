import { WordRecord } from './record'
import { newLearningAttemptId } from './attempt-identity'
import { compactTypingWordRecord } from './word-record-retention'
import type { PreparedWordRecord, WordRecordContext, WordRecordInput } from '@/learn/word-record-commit'

/** Preserve the existing record format/identity and mode-specific retention.
 * Evidence is supplied by the exercise; this adapter does not grade it.
 */
export function buildWordRecord(input: WordRecordInput, context: WordRecordContext): PreparedWordRecord {
  const timing = input.letterTimeArray.slice(1).map((time, index) => time - input.letterTimeArray[index])
  const record = new WordRecord(
    input.word, context.dict, context.chapter, timing, input.wrongCount, input.letterMistake,
    input.telemetry, input.learningContext, input.exerciseCondition, input.reviewPolicyDecision,
    input.reviewEvidence, input.reviewRatingDecision, input.reviewPolicyShadow, input.sourceMode, input.learnItemKind,
  )
  if (input.sourceMode === 'learn' && input.learnItemKind === 'review' &&
      input.reviewRatingDecision?.eligible === true && input.reviewBaseStateFingerprint) {
    record.reviewBaseStateFingerprint = input.reviewBaseStateFingerprint
  }
  record.attemptId = newLearningAttemptId()
  return compactTypingWordRecord(record) as PreparedWordRecord
}
