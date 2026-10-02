import type { LearnAcquisitionQuotaDecision } from './quota'
import type { LearnStatsSnapshot } from './stats'

export const LEARN_DAILY_PLAN_POLICY_VERSION = 'learn-daily-plan-v1'

export const learnDailyPlanPolicy = {
  acquisitionSoftBudgetMinutes: 20,
  fallbackReviewSecondsPerWord: 15,
  fallbackAcquisitionSecondsPerWord: 30,
} as const

export type LearnDailyPlanAction =
  | 'review-due'
  | 'acquire-new'
  | 'complete'

export type LearnDailyPlan = {
  policyVersion: typeof LEARN_DAILY_PLAN_POLICY_VERSION
  action: LearnDailyPlanAction
  dueReviewWords: number
  difficultDueWords: number
  newWordTarget: number
  newWordsCompleted: number
  quotaRemainingNewWords: number
  plannedRemainingNewWords: number
  allowedNewWordsNow: number
  todayActiveMinutes: number
  estimatedDueMinutes: number
  estimatedNewMinutes: number
  estimatedRemainingMinutes: number
  projectedTotalActiveMinutes: number
  acquisitionSoftBudgetMinutes: number
  timeModel: {
    reviewSecondsPerWord: number
    acquisitionSecondsPerWord: number
    reviewSource: 'observed-median' | 'fallback'
    acquisitionSource: 'observed-median' | 'fallback'
  }
  reasonCodes: string[]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function secondsToMinutes(value: number): number {
  return round1(value / 60)
}

export function buildLearnDailyPlan(input: {
  stats: LearnStatsSnapshot
  quota: LearnAcquisitionQuotaDecision
}): LearnDailyPlan {
  const { stats, quota } = input
  const policy = learnDailyPlanPolicy

  const reviewObserved =
    stats.effort.medianReviewSeconds !== null &&
    stats.effort.recentReviewSamples > 0
  const acquisitionObserved =
    stats.effort.medianAcquisitionSeconds !== null &&
    stats.effort.recentAcquisitionSamples > 0

  const reviewSecondsPerWord = reviewObserved
    ? (stats.effort.medianReviewSeconds as number)
    : policy.fallbackReviewSecondsPerWord
  const acquisitionSecondsPerWord = acquisitionObserved
    ? (stats.effort.medianAcquisitionSeconds as number)
    : policy.fallbackAcquisitionSecondsPerWord

  const dueSeconds = stats.lifecycle.due * reviewSecondsPerWord
  const softBudgetSeconds = policy.acquisitionSoftBudgetMinutes * 60

  // Due is never cut by this budget. Instead, project the room left for
  // Acquisition after today's already-spent work and all currently due Review.
  const projectedSecondsBeforeNew =
    stats.effort.todayActiveSeconds + dueSeconds
  const acquisitionSecondsAvailable = Math.max(
    0,
    softBudgetSeconds - projectedSecondsBeforeNew,
  )
  const workloadNewWordCapacity =
    acquisitionSecondsPerWord > 0
      ? Math.floor(acquisitionSecondsAvailable / acquisitionSecondsPerWord)
      : quota.remainingDailyNewWords

  const plannedRemainingNewWords = Math.min(
    quota.remainingDailyNewWords,
    workloadNewWordCapacity,
  )
  const allowedNewWordsNow =
    stats.lifecycle.due > 0 ? 0 : plannedRemainingNewWords

  const estimatedNewSeconds =
    plannedRemainingNewWords * acquisitionSecondsPerWord
  const estimatedRemainingSeconds = dueSeconds + estimatedNewSeconds
  const projectedTotalActiveSeconds =
    stats.effort.todayActiveSeconds + estimatedRemainingSeconds

  const reasonCodes = [...quota.reasonCodes]
  if (stats.lifecycle.due > 0) reasonCodes.push('daily-plan-due-first')
  if (plannedRemainingNewWords < quota.remainingDailyNewWords) {
    reasonCodes.push('daily-workload-soft-budget')
  }
  if (
    quota.remainingDailyNewWords > 0 &&
    plannedRemainingNewWords === 0 &&
    stats.lifecycle.due === 0
  ) {
    reasonCodes.push('daily-workload-budget-reached')
  }

  let action: LearnDailyPlanAction
  if (stats.lifecycle.due > 0) action = 'review-due'
  else if (allowedNewWordsNow > 0) action = 'acquire-new'
  else action = 'complete'

  return {
    policyVersion: LEARN_DAILY_PLAN_POLICY_VERSION,
    action,
    dueReviewWords: stats.lifecycle.due,
    difficultDueWords: stats.lifecycle.difficultDue,
    newWordTarget: quota.targetDailyNewWords,
    newWordsCompleted: stats.today.acquiredWords,
    quotaRemainingNewWords: quota.remainingDailyNewWords,
    plannedRemainingNewWords,
    allowedNewWordsNow,
    todayActiveMinutes: secondsToMinutes(stats.effort.todayActiveSeconds),
    estimatedDueMinutes: secondsToMinutes(dueSeconds),
    estimatedNewMinutes: secondsToMinutes(estimatedNewSeconds),
    estimatedRemainingMinutes: secondsToMinutes(estimatedRemainingSeconds),
    projectedTotalActiveMinutes: secondsToMinutes(projectedTotalActiveSeconds),
    acquisitionSoftBudgetMinutes: policy.acquisitionSoftBudgetMinutes,
    timeModel: {
      reviewSecondsPerWord,
      acquisitionSecondsPerWord,
      reviewSource: reviewObserved ? 'observed-median' : 'fallback',
      acquisitionSource: acquisitionObserved
        ? 'observed-median'
        : 'fallback',
    },
    reasonCodes: [...new Set(reasonCodes)],
  }
}
