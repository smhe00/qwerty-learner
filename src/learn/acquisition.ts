import type { LearnInteractionStrainTier } from './strain'
import {
  applyLearnRecoveryWindow,
  planLearnRecoveryWindow,
} from './recovery-window'
import type { LearnRecoveryWindowPlan } from './recovery-window'
import {
  decideLearnScaffold,
  getLearnScaffoldPresentation,
} from './scaffold'
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
export const MIN_INDEPENDENT_INTERVENING_ITEMS = 2 as const
export const MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS = 300 as const
export const MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS = 300 as const

export type LearnAcquisitionPhase =
  | 'exposure'
  | 'guided'
  | 'supported'
  | 'independent'
  | 'complete'
  | 'deferred'

export type LearnAcquisitionDeferredReason = 'assistance' | 'spacing'

export type LearnAcquisitionState = {
  version: typeof LEARN_ACQUISITION_FLOW_VERSION
  phase: LearnAcquisitionPhase
  assistedCycles: number
  // Session-start strain is frozen for deterministic presentation. In-session
  // difficulty still adapts through assistedCycles.
  scaffoldStrainTier?: LearnInteractionStrainTier
  scaffoldHintPosition?: number
  independentInterveningItems?: number
  deferredReason?: LearnAcquisitionDeferredReason
  resumeAfter?: number
}

export type LearnAcquisitionEvent =
  | { kind: 'exposure-complete' }
  | { kind: 'guided-committed' }
  | { kind: 'supported-complete' }
  | {
      kind: 'independent-complete'
      independentClean: boolean
      scaffoldHintPosition?: number
    }

export function createLearnAcquisitionState(options?: {
  scaffoldStrainTier?: LearnInteractionStrainTier
}): LearnAcquisitionState {
  return {
    version: LEARN_ACQUISITION_FLOW_VERSION,
    phase: 'exposure',
    assistedCycles: 0,
    ...(options?.scaffoldStrainTier !== undefined
      ? { scaffoldStrainTier: options.scaffoldStrainTier }
      : {}),
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
    return {
      ...state,
      phase: 'independent',
      scaffoldHintPosition: undefined,
      independentInterveningItems: undefined,
    }
  }

  if (state.phase === 'independent') {
    if (event.kind !== 'independent-complete') {
      throw new Error('independent requires independent-complete')
    }
    if (event.independentClean) {
      return {
        ...state,
        phase: 'complete',
        scaffoldHintPosition: undefined,
      }
    }

    const assistedCycles = state.assistedCycles + 1
    if (assistedCycles >= MAX_ACQUISITION_ASSISTED_CYCLES) {
      return {
        ...state,
        assistedCycles,
        phase: 'deferred',
        scaffoldHintPosition: event.scaffoldHintPosition,
        deferredReason: 'assistance',
      }
    }

    return {
      ...state,
      assistedCycles,
      phase: 'supported',
      scaffoldHintPosition: event.scaffoldHintPosition,
      independentInterveningItems: undefined,
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
  options?: {
    independentInterveningItems?: number
    scaffoldStrainTier?: LearnInteractionStrainTier
    scaffoldHintPosition?: number
    assistedCycles?: number
  },
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

  const scaffold = decideLearnScaffold({
    phase,
    strainTier: options?.scaffoldStrainTier ?? 'unknown',
    assistedCycles: options?.assistedCycles ?? 0,
    hintPosition: options?.scaffoldHintPosition,
  })
  const presentation = getLearnScaffoldPresentation(scaffold.level, {
    hintPosition: scaffold.hintPosition,
  })

  const condition = {
    version: 1 as const,
    purpose: presentation.purpose,
    source: 'adaptive-policy' as const,
    audio: presentation.audio,
    meaning: 'visible' as const,
    phonetic: presentation.phonetic,
    letters: presentation.letters,
    probeDimension: 'none' as const,
  }

  const presentationReasonCodes = [
    `dynamic-scaffold-${scaffold.level.toLowerCase()}`,
    ...scaffold.reasonCodes,
    presentation.letters.mode === 'all-visible'
      ? 'letters-visible'
      : 'letters-hidden',
    presentation.audio === 'automatic'
      ? 'automatic-audio'
      : 'audio-off',
    presentation.phonetic === 'visible'
      ? 'phonetic-visible'
      : 'phonetic-hidden',
  ]

  const reasonCodes = isExposure
    ? [
        'learn-acquisition-exposure',
        'visible-copy',
        'scheduler-neutral',
        ...presentationReasonCodes,
      ]
    : isIndependent
      ? [
          'learn-acquisition-independent',
          'delayed-recall',
          'scheduler-neutral',
          ...presentationReasonCodes,
          ...(options?.independentInterveningItems !== undefined
            ? [
                `intervening-items-${options.independentInterveningItems}`,
                ...(options.independentInterveningItems >=
                MIN_INDEPENDENT_INTERVENING_ITEMS
                  ? ['spacing-eligible']
                  : ['spacing-insufficient']),
              ]
            : []),
        ]
      : [
          'learn-acquisition-supported',
          'retrieval-with-bounded-hints',
          'scheduler-neutral',
          ...presentationReasonCodes,
        ]

  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition,
    decision: createReviewPolicyDecision(
      policyVersion,
      [...new Set(reasonCodes)],
      condition.version,
    ),
    sourceShadowVersion: REVIEW_POLICY_SHADOW_VERSION,
  }
}

export function createLearnAcquisitionExercisePlanForState(
  state: LearnAcquisitionState,
): ReviewExercisePlanV1 {
  return createLearnAcquisitionExercisePlan(state.phase, {
    independentInterveningItems: state.independentInterveningItems,
    scaffoldStrainTier: state.scaffoldStrainTier,
    scaffoldHintPosition: state.scaffoldHintPosition,
    assistedCycles: state.assistedCycles,
  })
}

export function getLearnAcquisitionScaffoldDecision(
  state: LearnAcquisitionState | undefined,
) {
  if (
    !state ||
    state.phase === 'complete' ||
    state.phase === 'deferred'
  ) {
    return undefined
  }

  return decideLearnScaffold({
    phase: state.phase,
    strainTier: state.scaffoldStrainTier ?? 'unknown',
    assistedCycles: state.assistedCycles,
    hintPosition: state.scaffoldHintPosition,
  })
}

export function isLearnAcquisitionHintPolicyVersion(
  policyVersion: string | undefined,
): boolean {
  return (
    policyVersion === LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION ||
    policyVersion === LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION
  )
}

export function deferLearnAcquisitionForSpacing(
  state: LearnAcquisitionState,
  now: number,
): LearnAcquisitionState {
  if (state.phase !== 'independent') {
    throw new Error('spacing deferral requires independent phase')
  }

  return {
    ...state,
    phase: 'deferred',
    deferredReason: 'spacing',
    resumeAfter:
      now + MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS,
  }
}

export function normalizeDeferredAcquisitionState(
  state: LearnAcquisitionState,
  deferredAt: number,
): LearnAcquisitionState {
  if (
    state.phase !== 'deferred' ||
    state.resumeAfter !== undefined
  ) {
    return state
  }

  if (state.deferredReason === 'assistance') {
    return {
      ...state,
      resumeAfter:
        deferredAt + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
    }
  }

  if (state.deferredReason === 'spacing') {
    return {
      ...state,
      resumeAfter:
        deferredAt +
        MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS,
    }
  }

  return state
}

export function scheduleAssistanceDeferredAcquisition(
  state: LearnAcquisitionState,
  now: number,
): LearnAcquisitionState {
  if (
    state.phase !== 'deferred' ||
    state.deferredReason !== 'assistance'
  ) {
    throw new Error(
      'assistance deferral scheduling requires assistance-deferred state',
    )
  }

  return {
    ...state,
    resumeAfter:
      now + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
  }
}

export function resumeDeferredAcquisition(
  state: LearnAcquisitionState,
  now: number,
): LearnAcquisitionState | undefined {
  if (
    state.phase !== 'deferred' ||
    state.resumeAfter === undefined ||
    now < state.resumeAfter
  ) {
    return undefined
  }

  if (state.deferredReason === 'spacing') {
    return {
      ...state,
      phase: 'independent',
      independentInterveningItems:
        MIN_INDEPENDENT_INTERVENING_ITEMS,
      deferredReason: undefined,
      resumeAfter: undefined,
    }
  }

  if (state.deferredReason === 'assistance') {
    return {
      ...state,
      phase: 'supported',
      independentInterveningItems: undefined,
      deferredReason: undefined,
      resumeAfter: undefined,
    }
  }

  return undefined
}

/**
 * Compatibility wrapper retained for callers/tests that specifically reason
 * about spacing-deferred Acquisition.
 */
export function resumeSpacingDeferredAcquisition(
  state: LearnAcquisitionState,
  now: number,
): LearnAcquisitionState | undefined {
  if (state.deferredReason !== 'spacing') return undefined
  return resumeDeferredAcquisition(state, now)
}

export function hasSufficientIndependentSpacing(
  state: LearnAcquisitionState,
): boolean {
  return (
    state.phase === 'independent' &&
    (state.independentInterveningItems ?? 0) >=
      MIN_INDEPENDENT_INTERVENING_ITEMS
  )
}

export function learnAcquisitionFollowUpGap(
  nextPhase: LearnAcquisitionPhase,
): number {
  if (nextPhase === 'supported') return 2
  if (nextPhase === 'independent') return 4
  return 0
}


export type LearnAcquisitionProgressProjection<T extends { name: string }> = {
  queue: T[]
  index: number
  isFinished: boolean
  interveningItemsBeforeFollowUp?: number
  insertWord?: {
    index: number
    word: T
  }
  recoveryWindow?: LearnRecoveryWindowPlan
}

/**
 * Queue projection is Learn-owned. Follow-up attempts are separated by
 * intervening words so a just-seen answer cannot immediately masquerade as
 * durable recall.
 */
export function projectLearnAcquisitionProgress<T extends { name: string }>(
  input: {
    queue: T[]
    currentIndex: number
    currentWord: T
    nextState: LearnAcquisitionState
    acquisitionStates?: Record<string, LearnAcquisitionState>
  },
): LearnAcquisitionProgressProjection<T> {
  const {
    queue,
    currentIndex,
    currentWord,
    nextState,
    acquisitionStates,
  } = input
  if (queue.length === 0) {
    throw new Error('acquisition queue must not be empty')
  }
  if (currentIndex < 0 || currentIndex >= queue.length) {
    throw new Error('acquisition currentIndex out of range')
  }
  if (queue[currentIndex]?.name !== currentWord.name) {
    throw new Error('acquisition currentWord must match queue[currentIndex]')
  }

  const recoveryWindow = planLearnRecoveryWindow({
    queue,
    currentIndex,
    currentWord,
    nextState,
    acquisitionStates,
  })
  const nextQueue = recoveryWindow.active
    ? applyLearnRecoveryWindow(
        queue,
        currentIndex,
        recoveryWindow.selectedNames,
      )
    : [...queue]
  let insertWord: LearnAcquisitionProgressProjection<T>['insertWord']
  let interveningItemsBeforeFollowUp: number | undefined

  if (
    nextState.phase === 'supported' ||
    nextState.phase === 'independent'
  ) {
    const pendingOffset = nextQueue
      .slice(currentIndex + 1)
      .findIndex((item) => item.name === currentWord.name)

    let followUpIndex =
      pendingOffset >= 0 ? currentIndex + 1 + pendingOffset : undefined

    if (followUpIndex === undefined) {
      const gap = Math.max(
        learnAcquisitionFollowUpGap(nextState.phase),
        recoveryWindow.active
          ? recoveryWindow.selectedNames.length
          : 0,
      )
      followUpIndex = Math.min(
        nextQueue.length,
        currentIndex + 1 + gap,
      )
      nextQueue.splice(followUpIndex, 0, currentWord)
      insertWord = { index: followUpIndex, word: currentWord }
    }

    interveningItemsBeforeFollowUp = Math.max(
      0,
      followUpIndex - currentIndex - 1,
    )
  }

  const nextIndex = currentIndex + 1
  if (nextIndex < nextQueue.length) {
    return {
      queue: nextQueue,
      index: nextIndex,
      isFinished: false,
      interveningItemsBeforeFollowUp,
      insertWord,
      ...(recoveryWindow.active ? { recoveryWindow } : {}),
    }
  }

  return {
    queue: nextQueue,
    index: Math.max(0, nextQueue.length - 1),
    isFinished: true,
    interveningItemsBeforeFollowUp,
    insertWord,
    ...(recoveryWindow.active ? { recoveryWindow } : {}),
  }
}
