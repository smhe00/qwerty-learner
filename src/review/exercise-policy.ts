import type { ExerciseConditionV1 } from './condition'
import { createReviewPolicyDecision, createReviewPolicyShadow } from './decision'
import type { ReviewPolicyDecisionV1, ReviewPolicyShadowV1 } from './decision'
import { buildOrthographyProfile } from './profile'
import type { OrthographyProfile } from './profile'
import type { IWordRecord } from '@/utils/db/record'

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

export function chooseTargetedMaskShadow(input: {
  baselineCondition: ExerciseConditionV1
  word: string
  records: IWordRecord[]
}): ReviewPolicyShadowV1 | null {
  const latestRecord = [...input.records].sort((left, right) => {
    const leftOrder = left.id ?? left.timeStamp
    const rightOrder = right.id ?? right.timeStamp
    return rightOrder - leftOrder
  })[0]

  if (
    latestRecord?.exerciseCondition?.letters.mode === 'targeted-mask' &&
    latestRecord.wrongCount === 0
  ) {
    return null
  }

  const plan = chooseTargetedMaskPlan({
    baselineCondition: input.baselineCondition,
    orthography: buildOrthographyProfile(input.word, input.records),
    wordLength: input.word.length,
  })

  return plan ? createReviewPolicyShadow(plan.condition, plan.decision) : null
}
