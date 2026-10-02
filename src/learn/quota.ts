import type { LearnStatsSnapshot } from './stats'

export const LEARN_ACQUISITION_QUOTA_POLICY_VERSION =
  'learn-acquisition-quota-v1'

export const learnAcquisitionQuotaPolicy = {
  low: 5,
  medium: 10,
  high: 20,
  minRatedEventsForAdaptation: 8,
  minTodayReviewAttemptsForColdSignal: 5,
  weakAgainRatePct: 35,
  moderateAgainRatePct: 20,
  weakColdProbePassRatePct: 60,
  strongColdProbePassRatePct: 80,
} as const

export type LearnAcquisitionQuotaTier = 'low' | 'medium' | 'high'

export type LearnAcquisitionQuotaDecision = {
  policyVersion: typeof LEARN_ACQUISITION_QUOTA_POLICY_VERSION
  tier: LearnAcquisitionQuotaTier
  targetDailyNewWords: number
  remainingDailyNewWords: number
  allowedNow: number
  pausedByDue: boolean
  reasonCodes: string[]
  signals: {
    dueCount: number
    unseenCount: number | null
    todayReviewedWords: number
    todayReviewAttempts: number
    todayAcquiredWords: number
    coldProbePassRateToday: number | null
    ratedEvents30d: number
    againRate30d: number | null
  }
}

function clampNonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(value))
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

export function decideDailyAcquisitionQuota(
  stats: LearnStatsSnapshot,
): LearnAcquisitionQuotaDecision {
  const policy = learnAcquisitionQuotaPolicy
  const ratedEvents = stats.scheduler.ratedEvents30d
  const againRate30d = percentage(
    stats.scheduler.ratings30d.again,
    ratedEvents,
  )
  const hasColdSignal =
    stats.today.reviewAttempts >=
      policy.minTodayReviewAttemptsForColdSignal &&
    stats.today.coldProbePassRate !== null

  let tier: LearnAcquisitionQuotaTier = 'high'
  const reasonCodes: string[] = []

  if (ratedEvents < policy.minRatedEventsForAdaptation) {
    reasonCodes.push('bootstrap-insufficient-rated-history')
  } else {
    const weakAgain =
      againRate30d !== null &&
      againRate30d >= policy.weakAgainRatePct
    const moderateAgain =
      againRate30d !== null &&
      againRate30d >= policy.moderateAgainRatePct
    const weakCold =
      hasColdSignal &&
      (stats.today.coldProbePassRate as number) <
        policy.weakColdProbePassRatePct
    const moderateCold =
      hasColdSignal &&
      (stats.today.coldProbePassRate as number) <
        policy.strongColdProbePassRatePct

    if (weakAgain || weakCold) {
      tier = 'low'
      reasonCodes.push(
        weakAgain ? 'high-again-rate' : 'low-cold-probe-pass-rate',
      )
    } else if (moderateAgain || moderateCold) {
      tier = 'medium'
      reasonCodes.push(
        moderateAgain
          ? 'moderate-again-rate'
          : 'moderate-cold-probe-pass-rate',
      )
    } else {
      reasonCodes.push('stable-review-performance')
    }
  }

  const targetDailyNewWords = policy[tier]
  const remainingBeforeUnseen = clampNonNegativeInteger(
    targetDailyNewWords - stats.today.acquiredWords,
  )
  const remainingDailyNewWords =
    stats.lifecycle.unseen === null
      ? remainingBeforeUnseen
      : Math.min(
          remainingBeforeUnseen,
          clampNonNegativeInteger(stats.lifecycle.unseen),
        )

  const pausedByDue = stats.lifecycle.due > 0
  const allowedNow = pausedByDue ? 0 : remainingDailyNewWords

  if (pausedByDue) reasonCodes.push('due-review-first')
  if (remainingBeforeUnseen === 0) {
    reasonCodes.push('daily-new-word-target-reached')
  }
  if (stats.lifecycle.unseen === 0) {
    reasonCodes.push('no-unseen-words')
  }

  return {
    policyVersion: LEARN_ACQUISITION_QUOTA_POLICY_VERSION,
    tier,
    targetDailyNewWords,
    remainingDailyNewWords,
    allowedNow,
    pausedByDue,
    reasonCodes: [...new Set(reasonCodes)],
    signals: {
      dueCount: stats.lifecycle.due,
      unseenCount: stats.lifecycle.unseen,
      todayReviewedWords: stats.today.reviewedWords,
      todayReviewAttempts: stats.today.reviewAttempts,
      todayAcquiredWords: stats.today.acquiredWords,
      coldProbePassRateToday: stats.today.coldProbePassRate,
      ratedEvents30d: ratedEvents,
      againRate30d,
    },
  }
}
