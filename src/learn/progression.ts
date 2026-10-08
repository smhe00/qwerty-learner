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
import {
  isCleanIndependentAcquisitionRecord,
  isValidModernAcquisitionAdmissionRecord,
} from './admission'
import type { IWordRecord } from '@/utils/db/record'
import type { Word } from '@/typings'

export type LearnAcquisitionCompletionInput = {
  queue: Word[]
  currentIndex: number
  currentWord: Word
  state: LearnAcquisitionState
  acquisitionStates: Record<string, LearnAcquisitionState>
  record: IWordRecord
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
      input.record.word === currentWord.name &&
      isCleanIndependentAcquisitionRecord(input.record)

    if (
      independentEvidenceClean &&
      (!hasSufficientIndependentSpacing(state) ||
        !isValidModernAcquisitionAdmissionRecord(input.record))
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

  let projection = projectLearnAcquisitionProgress({
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
    if (!hasSufficientIndependentSpacing(nextState)) {
      // A tail cannot supply enough intervening items. Do not ask for an
      // immediate probe whose result would necessarily be rejected; checkpoint
      // the delay now, and resume an Independent probe after five minutes.
      nextState = deferLearnAcquisitionForSpacing(nextState, input.now)
      projection = projectLearnAcquisitionProgress({
        queue: queue.filter((item, index) =>
          index <= currentIndex || item.name !== currentWord.name,
        ),
        currentIndex,
        currentWord,
        nextState,
        acquisitionStates: { ...projectedStates, [currentWord.name]: nextState },
      })
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
