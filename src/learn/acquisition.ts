import type { ReviewExercisePlanV1 } from '@/review/decision'
import {
  REVIEW_EXERCISE_PLAN_VERSION,
  REVIEW_POLICY_SHADOW_VERSION,
  createReviewPolicyDecision,
} from '@/review/decision'

export const LEARN_ACQUISITION_FLOW_VERSION = 1 as const
export const LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION =
  'learn-acquisition-exposure-v1'
export const LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION =
  'learn-acquisition-supported-v1'
export const LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION =
  'learn-acquisition-independent-v1'

export const MAX_ACQUISITION_ASSISTED_CYCLES = 2 as const

export type LearnAcquisitionPhase =
  | 'exposure'
  | 'guided'
  | 'supported'
  | 'independent'
  | 'complete'
  | 'deferred'

export type LearnAcquisitionState = {
  version: typeof LEARN_ACQUISITION_FLOW_VERSION
  phase: LearnAcquisitionPhase
  assistedCycles: number
}

export type LearnAcquisitionEvent =
  | { kind: 'exposure-complete' }
  | { kind: 'guided-committed' }
  | { kind: 'supported-complete' }
  | { kind: 'independent-complete'; independentClean: boolean }

export function createLearnAcquisitionState(): LearnAcquisitionState {
  return {
    version: LEARN_ACQUISITION_FLOW_VERSION,
    phase: 'exposure',
    assistedCycles: 0,
  }
}

export function decideLearnAcquisitionTransition(
  state: LearnAcquisitionState,
  event: LearnAcquisitionEvent,
): LearnAcquisitionState {
  if (state.phase === 'complete' || state.phase === 'deferred') {
    throw new Error('terminal acquisition state cannot accept another event')
  }

  if (state.phase === 'exposure') {
    if (event.kind !== 'exposure-complete') {
      throw new Error('exposure requires exposure-complete')
    }
    return { ...state, phase: 'guided' }
  }

  if (state.phase === 'guided') {
    if (event.kind !== 'guided-committed') {
      throw new Error('guided requires guided-committed')
    }
    return { ...state, phase: 'supported' }
  }

  if (state.phase === 'supported') {
    if (event.kind !== 'supported-complete') {
      throw new Error('supported requires supported-complete')
    }
    return { ...state, phase: 'independent' }
  }

  if (state.phase === 'independent') {
    if (event.kind !== 'independent-complete') {
      throw new Error('independent requires independent-complete')
    }
    if (event.independentClean) {
      return { ...state, phase: 'complete' }
    }

    const assistedCycles = state.assistedCycles + 1
    if (assistedCycles >= MAX_ACQUISITION_ASSISTED_CYCLES) {
      return {
        ...state,
        assistedCycles,
        phase: 'deferred',
      }
    }

    return {
      ...state,
      assistedCycles,
      phase: 'supported',
    }
  }

  throw new Error(`unsupported acquisition phase: ${state.phase}`)
}

/**
 * Exposure is deliberately a visible-answer copy pass. It creates familiarity
 * and a first successful motor trace, but is not long-term memory evidence.
 *
 * Guided is a transient controller state: after the visible copy succeeds,
 * the controller commits the success and schedules Supported Recall after
 * intervening words. It does not require a second immediate copy attempt.
 */
export function createLearnAcquisitionExercisePlan(
  phase: LearnAcquisitionPhase,
): ReviewExercisePlanV1 {
  if (phase === 'complete' || phase === 'deferred') {
    throw new Error(`terminal acquisition phase has no exercise plan: ${phase}`)
  }

  const isExposure = phase === 'exposure' || phase === 'guided'
  const isIndependent = phase === 'independent'
  const policyVersion = isExposure
    ? LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION
    : isIndependent
      ? LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION
      : LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION

  const condition = {
    version: 1 as const,
    purpose: isIndependent ? ('probe' as const) : ('training' as const),
    source: 'adaptive-policy' as const,
    audio: isExposure ? ('automatic' as const) : ('none' as const),
    meaning: 'visible' as const,
    phonetic: isExposure ? ('visible' as const) : ('hidden' as const),
    letters: {
      mode: isExposure ? ('all-visible' as const) : ('all-hidden' as const),
    },
    probeDimension: 'none' as const,
  }

  const reasonCodes = isExposure
    ? [
        'learn-acquisition-exposure',
        'visible-copy',
        'automatic-audio',
        'phonetic-visible',
        'scheduler-neutral',
      ]
    : isIndependent
      ? [
          'learn-acquisition-independent',
          'delayed-recall',
          'letters-hidden',
          'audio-off',
          'scheduler-neutral',
        ]
      : [
          'learn-acquisition-supported',
          'retrieval-with-bounded-hints',
          'letters-hidden',
          'audio-off',
          'scheduler-neutral',
        ]

  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition,
    decision: createReviewPolicyDecision(
      policyVersion,
      reasonCodes,
      condition.version,
    ),
    sourceShadowVersion: REVIEW_POLICY_SHADOW_VERSION,
  }
}

export function isLearnAcquisitionHintPolicyVersion(
  policyVersion: string | undefined,
): boolean {
  return (
    policyVersion === LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION ||
    policyVersion === LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION
  )
}

export function learnAcquisitionFollowUpGap(
  nextPhase: LearnAcquisitionPhase,
): number {
  if (nextPhase === 'supported') return 2
  if (nextPhase === 'independent') return 4
  return 0
}
