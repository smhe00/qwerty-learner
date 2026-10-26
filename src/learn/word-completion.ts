import { requireDurableWordRecordId } from './durable-word-record'
import type { DurableWordRecordReceipt } from './word-record-commit'
import type { TypingErrorClassification } from '@/review/classifier'
import type { ReviewPolicyShadowV1 } from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import type { RatingDecision } from '@/review/state-machine'
import type { IWordRecord } from '@/utils/db/record'

type CompletionEvidence = {
  record: IWordRecord
  wrongCount: number
  classification: TypingErrorClassification
  reviewRatingDecision?: RatingDecision
  reviewEvidence: ReviewEvidenceV1
  lastWrongIndex?: number
  nextExerciseShadow?: ReviewPolicyShadowV1 | null
}

export type WordFinishResult = CompletionEvidence & (
  | { mode: 'learn'; receipt: DurableWordRecordReceipt }
  | { mode: 'typing'; receipt?: DurableWordRecordReceipt }
)

/** Fail closed at the shared scheduler entry as well as the exercise UI. */
export function assertLearnCompletion(result: WordFinishResult, dict: string, word: string): void {
  if (result.mode !== 'learn' || !result.receipt ||
      result.receipt.sourceMode !== 'learn' ||
      result.receipt.dict !== dict || result.receipt.word !== word ||
      result.record.id !== result.receipt.id || result.record.attemptId !== result.receipt.attemptId ||
      result.record.dict !== dict || result.record.word !== word) {
    throw new Error('学习记录保存凭据与当前单词不一致，本词尚未推进。')
  }
  requireDurableWordRecordId(result.receipt.id)
}
