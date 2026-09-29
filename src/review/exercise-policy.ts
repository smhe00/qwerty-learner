import type { ExerciseConditionV1 } from './condition'
import { createReviewPolicyDecision } from './decision'
import type { ReviewPolicyDecisionV1 } from './decision'
import type { OrthographyProfile } from './profile'

export const TARGETED_MASK_POLICY_VERSION = 'targeted-mask-v1'

export const targetedMaskPolicy = {
  minFailedRecords: 3,
  minDominantRecordCount: 3,
  minDominantRecordRatio: 0.6,
} as const

export type ExercisePlan = {
  condition: ExerciseConditionV1
  decision: ReviewPolicyDecisionV1
}

export function chooseTargetedMaskPlan(input: {
  baselineCondition: ExerciseConditionV1
  orthography: OrthographyProfile
  wordLength: number
}): ExercisePlan | null {
  const { baselineCondition, orthography, wordLength } = input
  const index = orthography.dominantWrongIndex

  if (
    index === undefined ||
    index < 0 ||
    index >= wordLength ||
    orthography.failedRecordCount < targetedMaskPolicy.minFailedRecords ||
    orthography.dominantWrongRecordCount < targetedMaskPolicy.minDominantRecordCount ||
    orthography.dominantWrongRecordRatio < targetedMaskPolicy.minDominantRecordRatio
  ) {
    return null
  }

  const visiblePositions = Array.from({ length: wordLength }, (_, position) => position)
    .filter((position) => position !== index)

  const condition: ExerciseConditionV1 = {
    ...baselineCondition,
    purpose: 'training',
    source: 'adaptive-policy',
    letters: {
      mode: 'targeted-mask',
      visiblePositions,
      maskedPositions: [index],
    },
    probeDimension: 'none',
  }

  return {
    condition,
    decision: createReviewPolicyDecision(
      TARGETED_MASK_POLICY_VERSION,
      ['dominant-spelling-position', 'training-scaffold'],
      condition.version,
    ),
  }
}
