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
  | 'mixed'
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

  // Review debt remains first-class work, but only a bounded slice of it is
  // charged ahead of Acquisition. Otherwise a large backlog would starve new
  // words indefinitely even though Learn is designed as a continuous mode.
  const reviewPrioritySeconds =
    Math.min(stats.lifecycle.due, 15) * reviewSecondsPerWord
  const projectedSecondsBeforeNew =
    stats.effort.todayActiveSeconds + reviewPrioritySeconds
  // DailySession owns the user's explicit daily target. The time estimate is
  // advisory only: workload must not silently reduce a configured 32-word
  // target or make the daily completion invariant unreachable.
  const acquisitionSecondsAvailable = Math.max(
    0,
    softBudgetSeconds - projectedSecondsBeforeNew,
  )
  void acquisitionSecondsAvailable
  const plannedRemainingNewWords = quota.remainingDailyNewWords
  const allowedNewWordsNow = plannedRemainingNewWords

  const estimatedNewSeconds =
    plannedRemainingNewWords * acquisitionSecondsPerWord
  const estimatedRemainingSeconds = dueSeconds + estimatedNewSeconds
  const projectedTotalActiveSeconds =
    stats.effort.todayActiveSeconds + estimatedRemainingSeconds

  const reasonCodes = [...quota.reasonCodes]
  if (stats.lifecycle.due > 0) {
    reasonCodes.push('daily-plan-review-priority')
  }
  if (
    stats.effort.todayActiveSeconds + estimatedNewSeconds >
    softBudgetSeconds
  ) {
    reasonCodes.push('daily-workload-soft-budget-advisory')
  }

  let action: LearnDailyPlanAction
  if (stats.lifecycle.due > 0 && allowedNewWordsNow > 0) action = 'mixed'
  else if (stats.lifecycle.due > 0) action = 'review-due'
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
