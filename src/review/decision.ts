import type { ExerciseConditionV1 } from './condition'

export const REVIEW_POLICY_DECISION_VERSION = 1 as const
export const BASELINE_EXERCISE_POLICY_VERSION = 'baseline-user-settings-v1'
export const CANONICAL_REVIEW_PROBE_POLICY_VERSION = 'canonical-review-probe-v1'

export type ReviewPolicyDecisionV1 = {
  version: typeof REVIEW_POLICY_DECISION_VERSION
  policyVersion: string
  reasonCodes: string[]
  conditionVersion: ExerciseConditionV1['version']
}

/**
 * Baseline decision metadata for the pre-adaptive UI behaviour.
 *
 * Keeping this versioned from day one lets future policy versions be compared
 * against the original user-settings behaviour without guessing.
 */
export function createReviewPolicyDecision(
  policyVersion: string,
  reasonCodes: string[],
  conditionVersion: ExerciseConditionV1['version'] = 1,
): ReviewPolicyDecisionV1 {
  return {
    version: REVIEW_POLICY_DECISION_VERSION,
    policyVersion,
    reasonCodes: [...reasonCodes],
    conditionVersion,
  }
}

export function createBaselineReviewPolicyDecision(): ReviewPolicyDecisionV1 {
  return createReviewPolicyDecision(
    BASELINE_EXERCISE_POLICY_VERSION,
    ['baseline-user-settings'],
    1,
  )
}

export const REVIEW_POLICY_SHADOW_VERSION = 1 as const

export type ReviewPolicyShadowV1 = {
  version: typeof REVIEW_POLICY_SHADOW_VERSION
  mode: 'shadow'
  appliesTo: 'next-exercise'
  condition: ExerciseConditionV1
  decision: ReviewPolicyDecisionV1
}

export function createReviewPolicyShadow(
  condition: ExerciseConditionV1,
  policyDecision: ReviewPolicyDecisionV1,
): ReviewPolicyShadowV1 {
  return {
    version: REVIEW_POLICY_SHADOW_VERSION,
    mode: 'shadow',
    appliesTo: 'next-exercise',
    condition,
    decision: policyDecision,
  }
}

export const REVIEW_EXERCISE_PLAN_VERSION = 1 as const

export type ReviewExercisePlanV1 = {
  version: typeof REVIEW_EXERCISE_PLAN_VERSION
  condition: ExerciseConditionV1
  decision: ReviewPolicyDecisionV1
  sourceShadowVersion: ReviewPolicyShadowV1['version']
}

export function materializeReviewExercisePlan(
  shadow: ReviewPolicyShadowV1,
): ReviewExercisePlanV1 {
  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition: shadow.condition,
    decision: shadow.decision,
    sourceShadowVersion: shadow.version,
  }
}


export function createCanonicalReviewProbePlan(): ReviewExercisePlanV1 {
  const condition: ExerciseConditionV1 = {
    version: 1,
    purpose: 'probe',
    source: 'adaptive-policy',
    audio: 'none',
    meaning: 'visible',
    phonetic: 'hidden',
    letters: { mode: 'all-hidden' },
    probeDimension: 'none',
  }

  return {
    version: REVIEW_EXERCISE_PLAN_VERSION,
    condition,
    decision: createReviewPolicyDecision(
      CANONICAL_REVIEW_PROBE_POLICY_VERSION,
      [
        'canonical-long-term-probe',
        'meaning-to-orthography',
        'letters-hidden',
        'audio-off',
        'phonetic-hidden',
      ],
      condition.version,
    ),
    sourceShadowVersion: REVIEW_POLICY_SHADOW_VERSION,
  }
}
