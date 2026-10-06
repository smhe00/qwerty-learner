import type {
  ExerciseConditionV1,
  ExerciseLetterCondition,
} from './condition'
import {
  REVIEW_EXERCISE_PLAN_VERSION,
  REVIEW_POLICY_SHADOW_VERSION,
  createReviewPolicyDecision,
} from './decision'
import type { ReviewExercisePlanV1 } from './decision'

export const REVIEW_HINT_POLICY_VERSION =
  'canonical-review-hint-v2'
export const REVIEW_HINT_MAX_FAILURES = 3 as const

export type ReviewHintLevel = 0 | 1 | 2 | 3
export type ReviewHintStage =
  | 'cold-probe'
  | 'hint-0'
  | 'hint-1'
  | 'hint-2'
  | 'hint-3'

export type ReviewHintFailureCount = 0 | 1 | 2 | 3

export type ReviewHintMachineState = {
  stage: ReviewHintStage
  maxLevelReached: ReviewHintLevel | null
  coldProbeSurrendered: boolean
  advanceCount: 0 | 1 | 2 | 3 | 4
  // Global unsuccessful retrieval attempts for this word. Hint V2 never
  // replenishes this budget on stage transitions.
  failureCount: ReviewHintFailureCount
  // Position-specific Minimal Hint target.
  hintPosition: number | null
  // Last first-wrong position from the most recent spelling attempt.
  lastWrongIndex: number | null
  // Error counts by spelling position across the current word.
  wrongPositionCounts: Record<number, number>
  // Every observed wrong position remains visible once assistance begins.
  forcedRevealPositions: number[]
  // Legacy diagnostic field retained for DOM/backward compatibility. V2 does
  // not use stage-local retry budgets.
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
      failureCount: ReviewHintFailureCount
      trigger: 'manual-escape' | 'failed-retrieval'
    }

function failureCountForInitialLevel(
  level: ReviewHintLevel | undefined,
): ReviewHintFailureCount {
  if (level === undefined) return 0
  if (level === 0) return 1
  if (level === 1 || level === 2) return 2
  return 3
}

export function createReviewHintMachineState(options?: {
  initialLevel?: ReviewHintLevel
  hintPosition?: number
}): ReviewHintMachineState {
  const initialLevel = options?.initialLevel
  const hintPosition =
    options?.hintPosition !== undefined &&
    Number.isInteger(options.hintPosition) &&
    options.hintPosition >= 0
      ? options.hintPosition
      : null

  return {
    stage:
      initialLevel === undefined
        ? 'cold-probe'
        : (`hint-${initialLevel}` as ReviewHintStage),
    maxLevelReached: initialLevel ?? null,
    coldProbeSurrendered: false,
    advanceCount: 0,
    failureCount: failureCountForInitialLevel(initialLevel),
    hintPosition,
    lastWrongIndex: null,
    wrongPositionCounts: {},
    forcedRevealPositions: [],
    stageWrongCount: 0,
  }
}

/**
 * ESC is the only explicit surrender shortcut in Hint V2.
 *
 * It is valid at any input position and jumps directly to the mandatory full
 * answer. Space is deliberately not handled here as surrender; phrase spaces
 * continue through the ordinary typing path.
 */
export function decideReviewHintInput(input: {
  state: ReviewHintMachineState
  inputIndex: number
  key: string
}): ReviewHintInputDecision {
  if (input.key !== 'Escape') {
    return { kind: 'type-key' }
  }

  if (input.state.stage === 'hint-3') {
    return { kind: 'type-key' }
  }

  const hintPosition =
    input.state.hintPosition ??
    (input.state.lastWrongIndex ??
      Math.max(0, input.inputIndex))

  return {
    kind: 'advance-hint',
    from: input.state.stage,
    to: 'hint-3',
    level: 3,
    coldProbeSurrendered:
      input.state.coldProbeSurrendered ||
      input.state.stage === 'cold-probe',
    hintPosition,
    failureCount: input.state.failureCount,
    trigger: 'manual-escape',
  }
}

export function applyReviewHintDecision(
  state: ReviewHintMachineState,
  decision: ReviewHintInputDecision,
): ReviewHintMachineState {
  if (decision.kind === 'type-key') return state

  return {
    stage: decision.to,
    maxLevelReached:
      state.maxLevelReached === null
        ? decision.level
        : (Math.max(
            state.maxLevelReached,
            decision.level,
          ) as ReviewHintLevel),
    coldProbeSurrendered:
      decision.coldProbeSurrendered,
    advanceCount: Math.min(
      4,
      state.advanceCount + 1,
    ) as 0 | 1 | 2 | 3 | 4,
    failureCount: decision.failureCount,
    hintPosition: decision.hintPosition,
    lastWrongIndex: state.lastWrongIndex,
    wrongPositionCounts: {
      ...state.wrongPositionCounts,
    },
    forcedRevealPositions: [
      ...state.forcedRevealPositions,
    ],
    stageWrongCount: 0,
  }
}

// Compatibility exports for downstream code/tests. V2 escalates on every
// failed attempt and does not use stage-local retry thresholds.
export const AUTO_HINT0_REPEATED_WRONG_THRESHOLD = 1 as const
export const AUTO_HINT_STAGE_WRONG_THRESHOLD = 1 as const

export type ReviewHintWrongObservation = {
  state: ReviewHintMachineState
  decision: ReviewHintInputDecision | null
}

/**
 * Hint V2 global failure budget:
 *
 * fail #1 -> Minimal Hint (Hint 0)
 * fail #2 -> Strong Hint  (Hint 1)
 * fail #3 -> Full Answer  (Hint 3)
 *
 * Hint 2 remains a presentation compatibility level for legacy/scaffold
 * callers, but the automatic V2 path skips it.
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
  const nextFailureCount = Math.min(
    REVIEW_HINT_MAX_FAILURES,
    state.failureCount + 1,
  ) as ReviewHintFailureCount
  const wrongPositionCounts = {
    ...state.wrongPositionCounts,
    [wrongIndex]:
      (state.wrongPositionCounts[wrongIndex] ?? 0) + 1,
  }
  const forcedRevealPositions = [
    ...new Set([
      ...state.forcedRevealPositions,
      wrongIndex,
    ]),
  ].sort((left, right) => left - right)

  const observedState: ReviewHintMachineState = {
    ...state,
    failureCount: nextFailureCount,
    lastWrongIndex: wrongIndex,
    wrongPositionCounts,
    forcedRevealPositions,
    stageWrongCount:
      state.stage === 'hint-3'
        ? (Math.min(
            2,
            state.stageWrongCount + 1,
          ) as 0 | 1 | 2)
        : 1,
  }

  if (state.stage === 'hint-3') {
    return {
      state: observedState,
      decision: null,
    }
  }

  const target =
    nextFailureCount === 1
      ? {
          stage: 'hint-0' as const,
          level: 0 as const,
        }
      : nextFailureCount === 2
        ? {
            stage: 'hint-1' as const,
            level: 1 as const,
          }
        : {
            stage: 'hint-3' as const,
            level: 3 as const,
          }

  return {
    state: observedState,
    decision: {
      kind: 'advance-hint',
      from: state.stage,
      to: target.stage,
      level: target.level,
      coldProbeSurrendered:
        state.coldProbeSurrendered,
      hintPosition:
        state.hintPosition ?? wrongIndex,
      failureCount: nextFailureCount,
      trigger: 'failed-retrieval',
    },
  }
}

function maskedPositions(
  wordLength: number,
  visiblePositions: number[],
): number[] {
  const visible = new Set(visiblePositions)
  return Array.from(
    { length: wordLength },
    (_, index) => index,
  ).filter((index) => !visible.has(index))
}

function partialLetters(
  wordLength: number,
  visiblePositions: number[],
): ExerciseLetterCondition {
  const boundedVisible = [
    ...new Set(visiblePositions),
  ]
    .filter(
      (index) =>
        index >= 0 && index < wordLength,
    )
    .sort((left, right) => left - right)

  if (
    wordLength <= 0 ||
    boundedVisible.length === 0
  ) {
    return { mode: 'all-hidden' }
  }
  if (boundedVisible.length >= wordLength) {
    return { mode: 'all-visible' }
  }

  return {
    mode: 'partial',
    visiblePositions: boundedVisible,
    maskedPositions: maskedPositions(
      wordLength,
      boundedVisible,
    ),
  }
}

function strongHintPositions(
  wordLength: number,
  hintPosition: number,
  forcedRevealPositions: number[],
): number[] {
  const positions = Array.from(
    { length: wordLength },
    (_, index) => index,
  ).filter((index) => index % 2 === 0)

  if (
    wordLength > 0 &&
    !positions.includes(hintPosition)
  ) {
    positions.push(hintPosition)
  }
  positions.push(...forcedRevealPositions)
  return positions
}

export function reviewHintLetterCondition(
  level: ReviewHintLevel,
  wordLength: number,
  hintPosition = 0,
  forcedRevealPositions: number[] = [],
): ExerciseLetterCondition {
  if (level === 3) {
    return { mode: 'all-visible' }
  }

  const boundedHintPosition =
    wordLength <= 0
      ? 0
      : Math.min(
          Math.max(hintPosition, 0),
          wordLength - 1,
        )
  const boundedForcedPositions =
    forcedRevealPositions.filter(
      (index) =>
        index >= 0 && index < wordLength,
    )

  if (level === 0) {
    return partialLetters(
      wordLength,
      wordLength > 0
        ? [
            boundedHintPosition,
            ...boundedForcedPositions,
          ]
        : [],
    )
  }

  // V2 Strong Hint. Level 2 is kept as a compatibility alias for callers
  // that already persisted/selected that level.
  return partialLetters(
    wordLength,
    strongHintPositions(
      wordLength,
      boundedHintPosition,
      boundedForcedPositions,
    ),
  )
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
    phonetic:
      level >= 1 ? 'visible' : 'hidden',
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
          ? 'minimal-position-specific-cue'
          : level === 3
            ? 'full-answer-copy-training'
            : 'strong-partial-spelling-cue',
        `hint-position-${Math.max(
          0,
          hintPosition,
        )}`,
        `forced-reveal-${
          forcedRevealPositions.join('.') || 'none'
        }`,
      ],
      condition.version,
    ),
    sourceShadowVersion:
      REVIEW_POLICY_SHADOW_VERSION,
  }
}

const HINT_STAGE_RANK: Record<
  ReviewHintStage,
  number
> = {
  'cold-probe': 4,
  'hint-0': 3,
  'hint-1': 2,
  // Legacy compatibility level. V2 automatic escalation does not enter it.
  'hint-2': 1,
  'hint-3': 0,
}

/**
 * Every production Hint V2 escalation strictly decreases this value.
 */
export function reviewHintTerminationVariant(
  state: ReviewHintMachineState,
): number {
  return HINT_STAGE_RANK[state.stage]
}
