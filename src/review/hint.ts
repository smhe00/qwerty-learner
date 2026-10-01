import type { ExerciseConditionV1, ExerciseLetterCondition } from './condition'
import {
  REVIEW_EXERCISE_PLAN_VERSION,
  REVIEW_POLICY_SHADOW_VERSION,
  createReviewPolicyDecision,
} from './decision'
import type { ReviewExercisePlanV1 } from './decision'

export const REVIEW_HINT_POLICY_VERSION = 'canonical-review-hint-v1'

export type ReviewHintLevel = 0 | 1 | 2 | 3
export type ReviewHintStage =
  | 'cold-probe'
  | 'hint-0'
  | 'hint-1'
  | 'hint-2'
  | 'hint-3'

export type ReviewHintMachineState = {
  stage: ReviewHintStage
  maxLevelReached: ReviewHintLevel | null
  coldProbeSurrendered: boolean
  advanceCount: 0 | 1 | 2 | 3 | 4
}

export type ReviewHintInputDecision =
  | {
      kind: 'type-key'
    }
  | {
      kind: 'advance-hint'
      from: ReviewHintStage
      to: Exclude<ReviewHintStage, 'cold-probe'>
      level: ReviewHintLevel
      coldProbeSurrendered: boolean
    }

const NEXT_HINT: Record<
  Exclude<ReviewHintStage, 'hint-3'>,
  { stage: Exclude<ReviewHintStage, 'cold-probe'>; level: ReviewHintLevel }
> = {
  'cold-probe': { stage: 'hint-0', level: 0 },
  'hint-0': { stage: 'hint-1', level: 1 },
  'hint-1': { stage: 'hint-2', level: 2 },
  'hint-2': { stage: 'hint-3', level: 3 },
}

export function createReviewHintMachineState(): ReviewHintMachineState {
  return {
    stage: 'cold-probe',
    maxLevelReached: null,
    coldProbeSurrendered: false,
    advanceCount: 0,
  }
}

/**
 * Space is a Review hint-control key only at input position zero.
 *
 * cold -> hint0 -> hint1 -> hint2 -> hint3
 *
 * Hint 3 is terminal for hint escalation. Space at hint3 is therefore a
 * normal typing key (and will be wrong for ordinary English headwords), so
 * the learner must actually type the displayed word correctly to finish.
 */
export function decideReviewHintInput(input: {
  state: ReviewHintMachineState
  inputIndex: number
  key: string
}): ReviewHintInputDecision {
  if (input.key !== ' ' || input.inputIndex !== 0) {
    return { kind: 'type-key' }
  }

  if (input.state.stage === 'hint-3') {
    return { kind: 'type-key' }
  }

  const next = NEXT_HINT[input.state.stage]
  return {
    kind: 'advance-hint',
    from: input.state.stage,
    to: next.stage,
    level: next.level,
    coldProbeSurrendered:
      input.state.coldProbeSurrendered || input.state.stage === 'cold-probe',
  }
}

export function applyReviewHintDecision(
  state: ReviewHintMachineState,
  decision: ReviewHintInputDecision,
): ReviewHintMachineState {
  if (decision.kind === 'type-key') return state

  return {
    stage: decision.to,
    maxLevelReached: decision.level,
    coldProbeSurrendered: decision.coldProbeSurrendered,
    advanceCount: Math.min(4, state.advanceCount + 1) as 0 | 1 | 2 | 3 | 4,
  }
}

function maskedPositions(
  wordLength: number,
  visiblePositions: number[],
): number[] {
  const visible = new Set(visiblePositions)
  return Array.from({ length: wordLength }, (_, index) => index).filter(
    (index) => !visible.has(index),
  )
}

function partialLetters(
  wordLength: number,
  visiblePositions: number[],
): ExerciseLetterCondition {
  const boundedVisible = [...new Set(visiblePositions)]
    .filter((index) => index >= 0 && index < wordLength)
    .sort((left, right) => left - right)

  if (wordLength <= 0 || boundedVisible.length === 0) {
    return { mode: 'all-hidden' }
  }
  if (boundedVisible.length >= wordLength) {
    return { mode: 'all-visible' }
  }

  return {
    mode: 'partial',
    visiblePositions: boundedVisible,
    maskedPositions: maskedPositions(wordLength, boundedVisible),
  }
}

export function reviewHintLetterCondition(
  level: ReviewHintLevel,
  wordLength: number,
): ExerciseLetterCondition {
  if (level === 3) return { mode: 'all-visible' }

  if (level === 0 || level === 1) {
    return partialLetters(wordLength, wordLength > 0 ? [0] : [])
  }

  // Hint 2 reveals roughly half the spelling deterministically:
  // positions 0,2,4,...  Example: cancel -> c_n_e_
  const visiblePositions = Array.from(
    { length: wordLength },
    (_, index) => index,
  ).filter((index) => index % 2 === 0)
  return partialLetters(wordLength, visiblePositions)
}

export function createReviewHintPlan(
  level: ReviewHintLevel,
  wordLength: number,
): ReviewExercisePlanV1 {
  const condition: ExerciseConditionV1 = {
    version: 1,
    purpose: 'training',
    source: 'adaptive-policy',
    audio: level >= 1 ? 'automatic' : 'none',
    meaning: 'visible',
    phonetic: level >= 1 ? 'visible' : 'hidden',
    letters: reviewHintLetterCondition(level, wordLength),
    probeDimension: 'none',
  }

  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition,
    decision: createReviewPolicyDecision(
      REVIEW_HINT_POLICY_VERSION,
      [
        `review-hint-${level}`,
        level === 0
          ? 'first-letter-cue'
          : level === 1
            ? 'audio-phonetic-cue'
            : level === 2
              ? 'partial-spelling-cue'
              : 'full-answer-copy-training',
      ],
      condition.version,
    ),
    sourceShadowVersion: REVIEW_POLICY_SHADOW_VERSION,
  }
}

const HINT_STAGE_RANK: Record<ReviewHintStage, number> = {
  'cold-probe': 4,
  'hint-0': 3,
  'hint-1': 2,
  'hint-2': 1,
  'hint-3': 0,
}

/**
 * Variant used by the formal checker. Every space-driven hint escalation must
 * strictly decrease this value. Hint 3 has no escalation transition.
 */
export function reviewHintTerminationVariant(
  state: ReviewHintMachineState,
): number {
  return HINT_STAGE_RANK[state.stage]
}
