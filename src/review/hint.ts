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
  // Position-specific Hint 0 target. null means no spelling-error evidence yet.
  hintPosition: number | null
  // Last first-wrong position from the most recent spelling attempt.
  lastWrongIndex: number | null
  // Error counts by spelling position across the current word. Positions that
  // reach the threshold are forced visible at every non-terminal Hint level.
  wrongPositionCounts: Record<number, number>
  forcedRevealPositions: number[]
  // Failed spelling attempts within the current Hint stage. This counter is
  // reset on every hint-stage transition.
  stageWrongCount: 0 | 1 | 2
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
      hintPosition: number
      trigger:
        | 'manual-space'
        | 'repeated-wrong-position'
        | 'repeated-hint-errors'
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
    hintPosition: null,
    lastWrongIndex: null,
    wrongPositionCounts: {},
    forcedRevealPositions: [],
    stageWrongCount: 0,
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
  const hintPosition =
    input.state.hintPosition ??
    input.state.lastWrongIndex ??
    0

  return {
    kind: 'advance-hint',
    from: input.state.stage,
    to: next.stage,
    level: next.level,
    coldProbeSurrendered:
      input.state.coldProbeSurrendered || input.state.stage === 'cold-probe',
    hintPosition,
    trigger: 'manual-space',
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
    hintPosition: decision.hintPosition,
    lastWrongIndex: state.lastWrongIndex,
    wrongPositionCounts: { ...state.wrongPositionCounts },
    forcedRevealPositions: [...state.forcedRevealPositions],
    stageWrongCount: 0,
  }
}

export const AUTO_HINT0_REPEATED_WRONG_THRESHOLD = 2 as const
export const AUTO_HINT_STAGE_WRONG_THRESHOLD = 2 as const

export type ReviewHintWrongObservation = {
  state: ReviewHintMachineState
  decision: ReviewHintInputDecision | null
}

/**
 * Observe the first wrong position of one completed spelling attempt.
 *
 * Two independent adaptive signals are maintained:
 * - position count: a spelling position wrong twice becomes forced-visible at
 *   every non-terminal Hint level;
 * - stage count: once Hint 0/1/2 is active, two failed attempts at the current
 *   Hint level automatically advance to the next Hint level.
 *
 * Cold probe keeps its stricter entry rule: the same first-wrong position must
 * be observed twice before Hint 0 is entered automatically.
 */
export function observeReviewHintWrong(input: {
  state: ReviewHintMachineState
  wrongIndex: number
  wordLength: number
}): ReviewHintWrongObservation {
  const { state, wordLength } = input
  if (
    input.wrongIndex < 0 ||
    input.wrongIndex >= wordLength ||
    wordLength <= 0
  ) {
    return { state, decision: null }
  }

  const wrongIndex = input.wrongIndex
  const wrongPositionCounts = {
    ...state.wrongPositionCounts,
    [wrongIndex]: (state.wrongPositionCounts[wrongIndex] ?? 0) + 1,
  }
  const forcedRevealPositions =
    wrongPositionCounts[wrongIndex] >= AUTO_HINT0_REPEATED_WRONG_THRESHOLD
      ? [...new Set([...state.forcedRevealPositions, wrongIndex])].sort(
          (left, right) => left - right,
        )
      : [...state.forcedRevealPositions]
  const stageWrongCount = Math.min(
    AUTO_HINT_STAGE_WRONG_THRESHOLD,
    state.stageWrongCount + 1,
  ) as 0 | 1 | 2
  const observedState: ReviewHintMachineState = {
    ...state,
    lastWrongIndex: wrongIndex,
    wrongPositionCounts,
    forcedRevealPositions,
    stageWrongCount,
  }

  if (state.stage === 'cold-probe') {
    if (
      wrongPositionCounts[wrongIndex] <
      AUTO_HINT0_REPEATED_WRONG_THRESHOLD
    ) {
      return { state: observedState, decision: null }
    }

    return {
      state: observedState,
      decision: {
        kind: 'advance-hint',
        from: 'cold-probe',
        to: 'hint-0',
        level: 0,
        coldProbeSurrendered: state.coldProbeSurrendered,
        hintPosition: wrongIndex,
        trigger: 'repeated-wrong-position',
      },
    }
  }

  if (
    state.stage === 'hint-3' ||
    stageWrongCount < AUTO_HINT_STAGE_WRONG_THRESHOLD
  ) {
    return { state: observedState, decision: null }
  }

  const next = NEXT_HINT[state.stage]
  return {
    state: observedState,
    decision: {
      kind: 'advance-hint',
      from: state.stage,
      to: next.stage,
      level: next.level,
      coldProbeSurrendered: state.coldProbeSurrendered,
      hintPosition: state.hintPosition ?? wrongIndex,
      trigger: 'repeated-hint-errors',
    },
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
  hintPosition = 0,
  forcedRevealPositions: number[] = [],
): ExerciseLetterCondition {
  if (level === 3) return { mode: 'all-visible' }

  const boundedHintPosition =
    wordLength <= 0
      ? 0
      : Math.min(Math.max(hintPosition, 0), wordLength - 1)
  const boundedForcedPositions = forcedRevealPositions.filter(
    (index) => index >= 0 && index < wordLength,
  )

  if (level === 0 || level === 1) {
    return partialLetters(
      wordLength,
      wordLength > 0
        ? [boundedHintPosition, ...boundedForcedPositions]
        : [],
    )
  }

  // Hint 2 reveals roughly half the spelling deterministically and retains
  // both the original Hint 0 target and all forced-reveal error positions.
  const visiblePositions = Array.from(
    { length: wordLength },
    (_, index) => index,
  ).filter((index) => index % 2 === 0)
  if (wordLength > 0 && !visiblePositions.includes(boundedHintPosition)) {
    visiblePositions.push(boundedHintPosition)
  }
  visiblePositions.push(...boundedForcedPositions)
  return partialLetters(wordLength, visiblePositions)
}

export function createReviewHintPlan(
  level: ReviewHintLevel,
  wordLength: number,
  hintPosition = 0,
  forcedRevealPositions: number[] = [],
): ReviewExercisePlanV1 {
  const condition: ExerciseConditionV1 = {
    version: 1,
    purpose: 'training',
    source: 'adaptive-policy',
    audio: level >= 1 ? 'automatic' : 'none',
    meaning: 'visible',
    phonetic: level >= 1 ? 'visible' : 'hidden',
    letters: reviewHintLetterCondition(
      level,
      wordLength,
      hintPosition,
      forcedRevealPositions,
    ),
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
          ? 'position-specific-letter-cue'
          : level === 1
            ? 'audio-phonetic-cue'
            : level === 2
              ? 'partial-spelling-cue'
              : 'full-answer-copy-training',
        `hint-position-${Math.max(0, hintPosition)}`,
        `forced-reveal-${forcedRevealPositions.join('.') || 'none'}`,
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
