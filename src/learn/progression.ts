import {
  decideLearnAcquisitionTransition,
  deferLearnAcquisitionForSpacing,
  hasSufficientIndependentSpacing,
  projectLearnAcquisitionProgress,
  scheduleAssistanceDeferredAcquisition,
} from './acquisition'
import type {
  LearnAcquisitionProgressProjection,
  LearnAcquisitionState,
} from './acquisition'
import type { TypingErrorClassification } from '@/review/classifier'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import type { Word } from '@/typings'

export type LearnAcquisitionCompletionInput = {
  queue: Word[]
  currentIndex: number
  currentWord: Word
  state: LearnAcquisitionState
  acquisitionStates: Record<string, LearnAcquisitionState>
  wrongCount: number
  classificationCause: TypingErrorClassification['cause']
  retrievalValidity: ReviewEvidenceV1['retrievalValidity']
  lastWrongIndex?: number
  now: number
}

export type LearnAcquisitionCompletionResolution = {
  nextState: LearnAcquisitionState
  acquisitionStates: Record<string, LearnAcquisitionState>
  projection: LearnAcquisitionProgressProjection<Word>
  shouldPersistAdmission: boolean
}

/**
 * Shared word-level Acquisition controller.
 *
 * React and simulation drivers must both use this transition/projection logic.
 * The function is pure: persistence and UI dispatch remain adapter concerns.
 */
export function resolveLearnAcquisitionCompletion(
  input: LearnAcquisitionCompletionInput,
): LearnAcquisitionCompletionResolution {
  const {
    queue,
    currentIndex,
    currentWord,
    state,
    acquisitionStates,
  } = input

  let nextState: LearnAcquisitionState

  if (state.phase === 'exposure') {
    const guided = decideLearnAcquisitionTransition(
      state,
      { kind: 'exposure-complete' },
    )
    nextState = decideLearnAcquisitionTransition(
      guided,
      { kind: 'guided-committed' },
    )
  } else if (state.phase === 'guided') {
    nextState = decideLearnAcquisitionTransition(
      state,
      { kind: 'guided-committed' },
    )
  } else if (state.phase === 'supported') {
    nextState = decideLearnAcquisitionTransition(
      state,
      { kind: 'supported-complete' },
    )
  } else if (state.phase === 'independent') {
    const independentEvidenceClean =
      input.wrongCount === 0 &&
      input.classificationCause === 'clean' &&
      input.retrievalValidity === 'independent'

    if (
      independentEvidenceClean &&
      !hasSufficientIndependentSpacing(state)
    ) {
      nextState = deferLearnAcquisitionForSpacing(
        state,
        input.now,
      )
    } else {
      nextState = decideLearnAcquisitionTransition(
        state,
        {
          kind: 'independent-complete',
          independentClean: independentEvidenceClean,
          scaffoldHintPosition: input.lastWrongIndex,
        },
      )
      if (
        nextState.phase === 'deferred' &&
        nextState.deferredReason === 'assistance'
      ) {
        nextState = scheduleAssistanceDeferredAcquisition(
          nextState,
          input.now,
        )
      }
    }
  } else {
    throw new Error(
      `terminal acquisition state cannot complete: ${state.phase}`,
    )
  }

  const projectedStates = {
    ...acquisitionStates,
    [currentWord.name]: nextState,
  }

  const projection = projectLearnAcquisitionProgress({
    queue,
    currentIndex,
    currentWord,
    nextState,
    acquisitionStates: projectedStates,
  })

  if (nextState.phase === 'independent') {
    nextState = {
      ...nextState,
      independentInterveningItems:
        projection.interveningItemsBeforeFollowUp ?? 0,
    }
  }

  const nextStates = {
    ...projectedStates,
    [currentWord.name]: nextState,
  }

  return {
    nextState,
    acquisitionStates: nextStates,
    projection,
    shouldPersistAdmission: nextState.phase === 'complete',
  }
}
