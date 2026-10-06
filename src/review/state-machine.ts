import type { TypingErrorClassification } from './classifier'
import type { ExerciseConditionV1 } from './condition'
import type { ReviewEvidenceV1 } from './evidence'
import type { ReviewOutcome } from './types'

export const REVIEW_STATE_MACHINE_VERSION = 2 as const

export const MAX_INVALID_RETRY_PER_ITEM = 1 as const
export const MAX_REINFORCEMENT_PER_WORD_PER_SESSION = 1 as const
export const MAX_DIAGNOSTIC_PROBES_PER_WORD_PER_SESSION = 1 as const

export type ReviewAttemptRole = 'cold' | 'training' | 'reinforcement'

export type RatingNullReason =
  | 'training-event'
  | 'non-cold-attempt'
  | 'diagnostic-probe'
  | 'attention-uncertain'
  | 'answer-revealed'
  | 'orthographic-cue-not-hidden'
  | 'audio-assisted'
  | 'meaning-not-visible'
  | 'assisted-retrieval'

export type RatingDecision =
  | {
      eligible: false
      rating: null
      reason: RatingNullReason
      reasonCodes: string[]
    }
  | {
      eligible: true
      rating: ReviewOutcome
      confidence: number
      reasonCodes: string[]
    }

function nullRating(
  reason: RatingNullReason,
  reasonCodes: string[] = [reason],
): RatingDecision {
  return {
    eligible: false,
    rating: null,
    reason,
    reasonCodes,
  }
}

function hasReason(evidence: ReviewEvidenceV1, reason: string) {
  return evidence.reasonCodes.includes(reason)
}

/**
 * Scheduler-neutral rating gate.
 *
 * This function deliberately returns null for useful-but-non-schedulable
 * training/diagnostic evidence. Again/Hard/Good/Easy are reserved for a valid
 * long-term cold retrieval probe so the same decision layer can feed basic-v2
 * or a future FSRS-6 adapter.
 */
export function decideReviewRating(input: {
  attemptRole: ReviewAttemptRole
  condition: ExerciseConditionV1
  classification: TypingErrorClassification
  evidence: ReviewEvidenceV1
}): RatingDecision {
  const { attemptRole, condition, classification, evidence } = input

  // A first-position space on the canonical cold probe is an explicit
  // "I don't know" signal. Later hint-assisted completion is training, but
  // the cold-probe memory result is still an eligible Again.
  if (
    attemptRole === 'cold' &&
    hasReason(evidence, 'cold-probe-surrendered')
  ) {
    return {
      eligible: true,
      rating: 'again',
      confidence: 1,
      reasonCodes: [...new Set(evidence.reasonCodes)],
    }
  }

  if (
    attemptRole === 'cold' &&
    hasReason(evidence, 'cold-probe-failure-frozen') &&
    evidence.retrievalValidity === 'independent'
  ) {
    return {
      eligible: true,
      rating: evidence.memoryGrade,
      confidence: evidence.confidence,
      reasonCodes: [...new Set(evidence.reasonCodes)],
    }
  }

  if (attemptRole !== 'cold') {
    return nullRating('non-cold-attempt')
  }

  if (condition.purpose === 'training') {
    return nullRating('training-event')
  }

  if (condition.probeDimension !== 'none') {
    return nullRating('diagnostic-probe', [
      'diagnostic-probe',
      `probe-${condition.probeDimension}`,
    ])
  }

  if (
    classification.attentionUncertain ||
    evidence.retrievalValidity === 'uncertain' ||
    hasReason(evidence, 'attention-uncertain')
  ) {
    return nullRating('attention-uncertain')
  }

  if (hasReason(evidence, 'answer-revealed-before-first-key')) {
    return nullRating('answer-revealed')
  }

  if (evidence.retrievalValidity === 'assisted') {
    return nullRating('assisted-retrieval', [
      'assisted-retrieval',
      ...evidence.reasonCodes,
    ])
  }

  if (condition.letters.mode !== 'all-hidden') {
    return nullRating('orthographic-cue-not-hidden')
  }

  if (condition.audio !== 'none') {
    return nullRating('audio-assisted')
  }

  if (condition.meaning !== 'visible') {
    return nullRating('meaning-not-visible')
  }

  let rating: ReviewOutcome
  const reasonCodes = [...evidence.reasonCodes]

  switch (classification.cause) {
    case 'recall':
      rating = 'again'
      reasonCodes.push('canonical-recall-failure')
      break
    case 'spelling':
      rating = 'hard'
      reasonCodes.push('canonical-spelling-weakness')
      break
    case 'uncertain':
      rating = 'hard'
      reasonCodes.push('canonical-error-uncertain')
      break
    case 'motor':
      rating = 'good'
      reasonCodes.push('motor-error-memory-intact')
      break
    case 'clean':
      if (evidence.memoryGrade === 'easy') rating = 'easy'
      else if (evidence.memoryGrade === 'hard') rating = 'hard'
      else rating = 'good'
      reasonCodes.push('canonical-clean-retrieval')
      break
  }

  return {
    eligible: true,
    rating,
    confidence: classification.confidence,
    reasonCodes: [...new Set(reasonCodes)],
  }
}

export type ReviewItemPhase =
  | 'cold-probe'
  | 'invalid-retry'
  | 'training'
  | 'reinforcement'
  | 'deferred'
  | 'done'

export type ReviewItemMachineState = {
  phase: ReviewItemPhase
  ratingEmitted: boolean
  invalidRetryRemaining: 0 | 1
  reinforcementRemaining: 0 | 1
  diagnosticRemaining: 0 | 1
}

export function createReviewItemMachineState(): ReviewItemMachineState {
  return {
    phase: 'cold-probe',
    ratingEmitted: false,
    invalidRetryRemaining: MAX_INVALID_RETRY_PER_ITEM,
    reinforcementRemaining: MAX_REINFORCEMENT_PER_WORD_PER_SESSION,
    diagnosticRemaining: MAX_DIAGNOSTIC_PROBES_PER_WORD_PER_SESSION,
  }
}

export type ReviewItemEvent =
  | {
      kind: 'probe-result'
      decision: RatingDecision
      needsTraining: boolean
    }
  | {
      kind: 'training-complete'
      requestReinforcement: boolean
    }
  | {
      kind: 'reinforcement-complete'
    }

function isRetryableNullReason(reason: RatingNullReason) {
  return reason === 'attention-uncertain' || reason === 'answer-revealed'
}

export function isTerminalReviewItemState(state: ReviewItemMachineState) {
  return state.phase === 'deferred' || state.phase === 'done'
}

/**
 * Pure bounded Review-item transition machine.
 *
 * The machine intentionally has no transition that replenishes a consumed
 * budget. Therefore invalid probes, remediation and reinforcement cannot form
 * an infinite same-session cycle.
 */
export function decideReviewItemTransition(
  state: ReviewItemMachineState,
  event: ReviewItemEvent,
): ReviewItemMachineState {
  if (isTerminalReviewItemState(state)) {
    throw new Error('terminal review item cannot accept another event')
  }

  if (state.phase === 'cold-probe' || state.phase === 'invalid-retry') {
    if (event.kind !== 'probe-result') {
      throw new Error('probe phase requires a probe-result event')
    }

    if (event.decision.eligible) {
      if (state.ratingEmitted) {
        throw new Error('review item cannot emit more than one long-term rating')
      }

      return {
        ...state,
        ratingEmitted: true,
        phase: event.needsTraining ? 'training' : 'done',
      }
    }

    if (event.decision.reason === 'diagnostic-probe') {
      return {
        ...state,
        diagnosticRemaining: 0,
        phase: 'deferred',
      }
    }

    if (
      isRetryableNullReason(event.decision.reason) &&
      state.invalidRetryRemaining > 0
    ) {
      return {
        ...state,
        invalidRetryRemaining: 0,
        phase: 'invalid-retry',
      }
    }

    return {
      ...state,
      phase: 'deferred',
    }
  }

  if (state.phase === 'training') {
    if (event.kind !== 'training-complete') {
      throw new Error('training phase requires a training-complete event')
    }

    if (event.requestReinforcement && state.reinforcementRemaining > 0) {
      return {
        ...state,
        reinforcementRemaining: 0,
        phase: 'reinforcement',
      }
    }

    return {
      ...state,
      phase: 'done',
    }
  }

  if (state.phase === 'reinforcement') {
    if (event.kind !== 'reinforcement-complete') {
      throw new Error(
        'reinforcement phase requires a reinforcement-complete event',
      )
    }

    return {
      ...state,
      phase: 'done',
    }
  }

  throw new Error(`unsupported review item phase: ${state.phase}`)
}

export type CompletedReviewItemResolution =
  | {
      kind: 'retry-canonical'
      state: ReviewItemMachineState
    }
  | {
      kind: 'advance'
      state: ReviewItemMachineState
      insertReinforcement: boolean
    }

/**
 * Bridge one completed UI word into the proven bounded item machine.
 *
 * A WordComponent completion may already contain both the failed cold probe
 * and its mandatory corrective typing (for example the Hint ladder). When an
 * eligible result still needs same-session reinforcement, the logical
 * probe-result -> training-complete pair is therefore consumed atomically and
 * leaves the item in the finite reinforcement phase.
 */
export function resolveCompletedReviewItem(input: {
  state: ReviewItemMachineState
  attemptRole: ReviewAttemptRole
  decision: RatingDecision
  requestReinforcement: boolean
}): CompletedReviewItemResolution {
  if (input.attemptRole === 'reinforcement') {
    const reinforcementState: ReviewItemMachineState =
      input.state.phase === 'reinforcement'
        ? input.state
        : {
            ...input.state,
            phase: 'reinforcement',
            ratingEmitted: true,
            reinforcementRemaining: 0,
          }

    return {
      kind: 'advance',
      state: decideReviewItemTransition(reinforcementState, {
        kind: 'reinforcement-complete',
      }),
      insertReinforcement: false,
    }
  }

  if (
    input.state.phase !== 'cold-probe' &&
    input.state.phase !== 'invalid-retry'
  ) {
    throw new Error(
      `cold Review completion cannot start from ${input.state.phase}`,
    )
  }

  const afterProbe = decideReviewItemTransition(input.state, {
    kind: 'probe-result',
    decision: input.decision,
    needsTraining:
      input.decision.eligible && input.requestReinforcement,
  })

  if (afterProbe.phase === 'invalid-retry') {
    return {
      kind: 'retry-canonical',
      state: afterProbe,
    }
  }

  if (afterProbe.phase === 'training') {
    const afterTraining = decideReviewItemTransition(afterProbe, {
      kind: 'training-complete',
      requestReinforcement: true,
    })
    return {
      kind: 'advance',
      state: afterTraining,
      insertReinforcement: afterTraining.phase === 'reinforcement',
    }
  }

  return {
    kind: 'advance',
    state: afterProbe,
    insertReinforcement: false,
  }
}

const PHASE_RANK: Record<ReviewItemPhase, number> = {
  'cold-probe': 5,
  'invalid-retry': 4,
  training: 3,
  reinforcement: 2,
  deferred: 0,
  done: 0,
}

/**
 * Well-founded termination variant for formal verification.
 *
 * Every legal production transition must strictly decrease this non-negative
 * integer. Consumed budgets are never replenished.
 */
export function reviewItemTerminationVariant(
  state: ReviewItemMachineState,
): number {
  return (
    PHASE_RANK[state.phase] * 100 +
    state.invalidRetryRemaining * 10 +
    state.reinforcementRemaining * 3 +
    state.diagnosticRemaining
  )
}
