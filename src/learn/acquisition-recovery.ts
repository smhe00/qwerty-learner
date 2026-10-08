import {
  createLearnAcquisitionExercisePlanForState,
  createLearnAcquisitionState,
  normalizeDeferredAcquisitionState,
} from './acquisition'
import type { LearnAcquisitionState } from './acquisition'
import {
  isAcquisitionIntroductionRecord,
  isCompletedAcquisitionRecord,
} from './admission'
import type { IReviewWordState } from '@/review/types'
import type { IReviewRecord, IWordRecord } from '@/utils/db/record'

/** Raw admission/lifecycle evidence outranks a historical phase=complete flag. */
export function collectPendingAcquisitionStates(input: {
  records: IReviewRecord[]
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
}): Map<string, LearnAcquisitionState> {
  const admitted = new Set(input.wordStates.map((state) => state.word))
  const validAdmissions = new Set(
    input.wordRecords.filter(isCompletedAcquisitionRecord).map((record) => record.word),
  )
  const latest = new Map<string, LearnAcquisitionState>()
  for (const record of [...input.records].sort(
    (left, right) => left.createTime - right.createTime || (left.id ?? 0) - (right.id ?? 0),
  )) {
    for (const [word, state] of Object.entries(record.acquisitionStates ?? {})) {
      latest.set(word, normalizeDeferredAcquisitionState(state, record.createTime))
    }
  }
  for (const record of input.wordRecords) {
    if (isAcquisitionIntroductionRecord(record) && !latest.has(record.word)) {
      latest.set(record.word, createLearnAcquisitionState())
    }
  }
  const pending = new Map<string, LearnAcquisitionState>()
  for (const [word, state] of latest) {
    // Exclusions and valid admission must never be undone by stale checkpoints.
    if (admitted.has(word) || validAdmissions.has(word)) continue
    pending.set(word, state.phase === 'complete' ? {
      ...state,
      phase: 'supported',
      independentInterveningItems: undefined,
      deferredReason: undefined,
      resumeAfter: undefined,
    } : state)
  }
  return pending
}

/** Repair an unfinished checkpoint without moving its authoritative cursor. */
export function repairUnadmittedAcquisitionCheckpoint(
  record: IReviewRecord,
  pending: Map<string, LearnAcquisitionState>,
): IReviewRecord {
  if (record.isFinished) return record
  let repaired = record
  for (const [word, state] of Object.entries(record.acquisitionStates ?? {})) {
    const recovered = pending.get(word)
    if (state.phase !== 'complete' || !recovered) continue
    const item = record.words.find((candidate) => candidate.name === word)
    if (!item) continue
    const words = [...repaired.words]
    if (!words.slice(repaired.index).some((candidate) => candidate.name === word)) {
      words.push(item)
    }
    const hintStates = { ...repaired.hintStates }
    delete hintStates[word]
    repaired = {
      ...repaired,
      words,
      acquisitionStates: { ...repaired.acquisitionStates, [word]: recovered },
      exercisePlans: {
        ...repaired.exercisePlans,
        [word]: createLearnAcquisitionExercisePlanForState(recovered),
      },
      hintStates,
    }
  }
  return repaired
}
