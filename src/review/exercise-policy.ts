import type { ExerciseConditionV1 } from './condition'
import {
  CANONICAL_REVIEW_PROBE_POLICY_VERSION,
  createBaselineReviewPolicyDecision,
  createReviewPolicyDecision,
  createReviewPolicyShadow,
} from './decision'
import type {
  ReviewExercisePlanV1,
  ReviewPolicyDecisionV1,
  ReviewPolicyShadowV1,
} from './decision'
import { buildOrthographyProfile } from './profile'
import type { OrthographyProfile } from './profile'
import { typingClassifierPolicy } from './policy'
import type { IWordRecord } from '@/utils/db/record'

export const TARGETED_MASK_POLICY_VERSION = 'targeted-mask-v1'
export const AUDIO_WITHDRAWAL_POLICY_VERSION = 'audio-withdrawal-probe-v1'

export const targetedMaskPolicy = {
  minFailedRecords: 3,
  minDominantRecordCount: 3,
  minDominantRecordRatio: 0.6,
} as const

export const audioWithdrawalPolicy = {
  minComparableCleanRecords: 3,
  maxFirstKeyLatencyMs: typingClassifierPolicy.longFirstKeyMs,
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

export function resolveExercisePlanForAttempt(
  baselineCondition: ExerciseConditionV1,
  frozenPlan?: ReviewExercisePlanV1,
): ExercisePlan {
  if (
    frozenPlan?.decision.policyVersion === TARGETED_MASK_POLICY_VERSION ||
    frozenPlan?.decision.policyVersion === AUDIO_WITHDRAWAL_POLICY_VERSION ||
    frozenPlan?.decision.policyVersion === CANONICAL_REVIEW_PROBE_POLICY_VERSION
  ) {
    return {
      condition: frozenPlan.condition,
      decision: frozenPlan.decision,
    }
  }

  return {
    condition: baselineCondition,
    decision: createBaselineReviewPolicyDecision(),
  }
}

function recordOrderDescending(left: IWordRecord, right: IWordRecord): number {
  const leftOrder = left.id ?? left.timeStamp
  const rightOrder = right.id ?? right.timeStamp
  return rightOrder - leftOrder
}

function comparableAudioMasteryRecord(
  record: IWordRecord,
  baselineCondition: ExerciseConditionV1,
): boolean {
  const condition = record.exerciseCondition
  const context = record.learningContext
  const telemetry = record.typingTelemetry

  return Boolean(
    condition &&
      condition.audio === 'automatic' &&
      condition.meaning === baselineCondition.meaning &&
      condition.phonetic === baselineCondition.phonetic &&
      condition.letters.mode === baselineCondition.letters.mode &&
      record.wrongCount === 0 &&
      !context?.revealedBeforeFirstKey &&
      !context?.meaningRevealedBeforeFirstKey &&
      (context?.pronunciationAutomaticPlayCount ?? 0) > 0 &&
      telemetry?.firstKeyLatencyMs !== undefined &&
      telemetry.firstKeyLatencyMs <= audioWithdrawalPolicy.maxFirstKeyLatencyMs,
  )
}

export function chooseAudioWithdrawalShadow(input: {
  baselineCondition: ExerciseConditionV1
  word: string
  records: IWordRecord[]
}): ReviewPolicyShadowV1 | null {
  const { baselineCondition } = input
  if (baselineCondition.audio !== 'automatic') return null

  const recent = [...input.records]
    .sort(recordOrderDescending)
    .slice(0, audioWithdrawalPolicy.minComparableCleanRecords)

  if (
    recent.length < audioWithdrawalPolicy.minComparableCleanRecords ||
    !recent.every((record) =>
      comparableAudioMasteryRecord(record, baselineCondition),
    )
  ) {
    return null
  }

  const latest = recent[0]
  if (
    latest.exerciseCondition?.purpose === 'probe' &&
    latest.exerciseCondition.probeDimension === 'audio'
  ) {
    return null
  }

  const condition: ExerciseConditionV1 = {
    ...baselineCondition,
    purpose: 'probe',
    source: 'adaptive-policy',
    audio: 'none',
    probeDimension: 'audio',
  }

  return createReviewPolicyShadow(
    condition,
    createReviewPolicyDecision(
      AUDIO_WITHDRAWAL_POLICY_VERSION,
      ['stable-audio-assisted-recall', 'single-variable-audio-withdrawal'],
      condition.version,
    ),
  )
}

export function chooseNextExerciseShadow(input: {
  baselineCondition: ExerciseConditionV1
  word: string
  records: IWordRecord[]
}): ReviewPolicyShadowV1 | null {
  const targetedMask = chooseTargetedMaskShadow(input)
  if (targetedMask) return targetedMask

  return chooseAudioWithdrawalShadow(input)
}
