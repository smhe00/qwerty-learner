import type { TypingErrorClassification } from './classifier'
import {
  createCanonicalReviewProbePlan,
  materializeReviewExercisePlan,
} from './decision'
import type {
  ReviewExercisePlanV1,
  ReviewPolicyShadowV1,
} from './decision'
import {
  decideReviewProgress,
  projectReviewProgress,
} from './machine'
import type { ReviewProgressProjection } from './machine'
import {
  MAX_REINFORCEMENT_GAP,
  getAdaptiveReinforcementGap,
} from './session'
import {
  createReviewItemMachineState,
  resolveCompletedReviewItem,
} from './state-machine'
import type {
  RatingDecision,
  ReviewAttemptRole,
  ReviewItemMachineState,
} from './state-machine'
import type { Word } from '@/typings'

export type ReviewCompletionAction =
  | 'retry-current'
  | 'advance'
  | 'finish'

export type ReviewCompletionResolution = {
  action: ReviewCompletionAction
  projection: ReviewProgressProjection<Word>
  exercisePlans?: Record<string, ReviewExercisePlanV1>
  reinforcementCounts?: Record<string, number>
  itemStates: Record<string, ReviewItemMachineState>
  insertWord?: {
    index: number
    word: Word
  }
}

/**
 * Pure Review word-completion controller shared by the React adapter and the
 * system simulator.
 *
 * This owns bounded item-machine resolution and queue projection. It does not
 * persist scheduler state and it does not dispatch UI actions.
 */
export function resolveReviewCompletion(input: {
  queue: Word[]
  currentIndex: number
  currentWord: Word
  ratingDecision: RatingDecision
  attemptRole: ReviewAttemptRole
  wrongCount: number
  classification: TypingErrorClassification
  exercisePlans?: Record<string, ReviewExercisePlanV1>
  reinforcementCounts?: Record<string, number>
  itemStates?: Record<string, ReviewItemMachineState>
  nextExerciseShadow?: ReviewPolicyShadowV1
}): ReviewCompletionResolution {
  const currentItemState =
    input.itemStates?.[input.currentWord.name] ??
    createReviewItemMachineState()
  const requestReinforcement =
    input.ratingDecision.eligible &&
    (input.wrongCount > 0 ||
      input.ratingDecision.rating === 'again' ||
      input.ratingDecision.rating === 'hard')

  const itemResolution = resolveCompletedReviewItem({
    state: currentItemState,
    attemptRole: input.attemptRole,
    decision: input.ratingDecision,
    requestReinforcement,
  })

  const exercisePlans = {
    ...(input.exercisePlans ?? {}),
  }
  const reinforcementCounts = {
    ...(input.reinforcementCounts ?? {}),
  }
  const itemStates = {
    ...(input.itemStates ?? {}),
    [input.currentWord.name]: itemResolution.state,
  }

  if (itemResolution.kind === 'retry-canonical') {
    exercisePlans[input.currentWord.name] =
      createCanonicalReviewProbePlan()

    return {
      action: 'retry-current',
      projection: {
        queue: input.queue,
        index: input.currentIndex,
        isFinished: false,
      },
      exercisePlans,
      reinforcementCounts:
        Object.keys(reinforcementCounts).length > 0
          ? reinforcementCounts
          : undefined,
      itemStates,
    }
  }

  const attemptGap =
    input.wrongCount > 0
      ? getAdaptiveReinforcementGap(
          input.wrongCount,
          input.classification,
        )
      : MAX_REINFORCEMENT_GAP
  const decision = decideReviewProgress({
    queue: input.queue,
    currentIndex: input.currentIndex,
    currentWord: input.currentWord,
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: input.wrongCount,
    currentReinforcementGap: MAX_REINFORCEMENT_GAP,
    attemptReinforcementGap: attemptGap,
    reinforcementRemaining:
      itemResolution.insertReinforcement ? 1 : 0,
    requestReinforcement:
      itemResolution.insertReinforcement,
  })
  const projection = projectReviewProgress({
    queue: input.queue,
    currentIndex: input.currentIndex,
    decision,
  })

  if (decision.kind === 'advance' && decision.insertWord) {
    reinforcementCounts[input.currentWord.name] =
      (reinforcementCounts[input.currentWord.name] ?? 0) + 1

    if (input.nextExerciseShadow) {
      exercisePlans[input.currentWord.name] =
        materializeReviewExercisePlan(
          input.nextExerciseShadow,
        )
    } else if (!exercisePlans[input.currentWord.name]) {
      exercisePlans[input.currentWord.name] =
        createCanonicalReviewProbePlan()
    }
  }

  return {
    action:
      decision.kind === 'advance' ? 'advance' : 'finish',
    projection,
    exercisePlans:
      Object.keys(exercisePlans).length > 0
        ? exercisePlans
        : undefined,
    reinforcementCounts:
      Object.keys(reinforcementCounts).length > 0
        ? reinforcementCounts
        : undefined,
    itemStates,
    ...(decision.kind === 'advance' && decision.insertWord
      ? { insertWord: decision.insertWord }
      : {}),
  }
}
