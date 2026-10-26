import { requireDurableWordRecordId } from './durable-word-record'
import type { LearnItemKind } from './session'
import type { ExerciseConditionV1 } from '@/review/condition'
import type { ReviewPolicyDecisionV1, ReviewPolicyShadowV1 } from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import type { RatingDecision } from '@/review/state-machine'
import type { IWordRecord, LearningContextV1, LetterMistakes, WordRecordTelemetry } from '@/utils/db/record'

export type WordRecordInput = {
  word: string
  wrongCount: number
  letterTimeArray: number[]
  letterMistake: LetterMistakes
  telemetry?: WordRecordTelemetry
  learningContext?: LearningContextV1
  exerciseCondition?: ExerciseConditionV1
  reviewPolicyDecision?: ReviewPolicyDecisionV1
  reviewEvidence?: ReviewEvidenceV1
  reviewRatingDecision?: RatingDecision
  reviewPolicyShadow?: ReviewPolicyShadowV1
  reviewBaseStateFingerprint?: string
  sourceMode: 'typing' | 'learn'
  learnItemKind?: LearnItemKind
}

export type WordRecordContext = {
  dict: string
  chapter: number
  sessionId?: string
  sessionFinished: boolean
  sessionIndex?: number
  sessionQueueLength?: number
}

export type PreparedWordRecord = IWordRecord & { attemptId: string }
declare const receiptBrand: unique symbol
/** Local commit evidence, never an account-sync or cloud acknowledgement.
 * Only this service creates the nominal type after the write port resolves.
 * Receipts stay in memory; they are not added to persisted record schemas.
 */
export type DurableWordRecordReceipt = Readonly<{
  id: number
  attemptId: string
  dict: string
  word: string
  sourceMode: 'typing' | 'learn'
  record: Readonly<PreparedWordRecord & { id: number }>
  [receiptBrand]: true
}>

export type PostCommitOutcome =
  | { effect: string; status: 'fulfilled' }
  | { effect: string; status: 'rejected'; error: unknown }

export type WordRecordCommitResult =
  | { status: 'rejected'; reason: 'session-finished' }
  | { status: 'failed'; stage: 'prepare' | 'write'; error: unknown }
  | { status: 'saved'; receipt: DurableWordRecordReceipt; effects: Promise<PostCommitOutcome[]> }

export type WordRecordCommitPorts = {
  prepare: (input: WordRecordInput, context: WordRecordContext) => PreparedWordRecord
  add: (record: PreparedWordRecord) => Promise<number>
  effects: ReadonlyArray<{ name: string; run: (receipt: DurableWordRecordReceipt) => void | Promise<unknown> }>
  reportEffectError: (name: string, error: unknown) => void
}

export async function commitWordRecord(
  input: WordRecordInput,
  context: WordRecordContext,
  ports: WordRecordCommitPorts,
): Promise<WordRecordCommitResult> {
  if (input.sourceMode === 'learn' && context.sessionFinished) {
    return { status: 'rejected', reason: 'session-finished' }
  }
  let record: PreparedWordRecord
  try {
    record = ports.prepare(input, context)
  } catch (error) {
    return { status: 'failed', stage: 'prepare', error }
  }
  let id: number
  try {
    id = requireDurableWordRecordId(await ports.add(record))
  } catch (error) {
    return { status: 'failed', stage: 'write', error }
  }
  const receipt = Object.freeze({
    id, attemptId: record.attemptId, dict: record.dict, word: record.word, sourceMode: input.sourceMode,
    record: Object.freeze({ ...record, id }),
  }) as DurableWordRecordReceipt

  // Invoke every port before returning, so tracked projections are registered
  // before completion can flush them. Never await effects to release the UI,
  // and never turn a post-commit failure into permission to write again.
  const effects = Promise.all(ports.effects.map(async (effect): Promise<PostCommitOutcome> => {
    try {
      await effect.run(receipt)
      return { effect: effect.name, status: 'fulfilled' }
    } catch (error) {
      try { ports.reportEffectError(effect.name, error) } catch { /* Reporting cannot undo a commit. */ }
      return { effect: effect.name, status: 'rejected', error }
    }
  }))
  return { status: 'saved', receipt, effects }
}
