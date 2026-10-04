import type { LearnStatsSnapshot } from './stats'

export const LEARN_ACQUISITION_QUOTA_POLICY_VERSION =
  'learn-acquisition-quota-v3'

export const learnAcquisitionQuotaPolicy = {
  low: 5,
  medium: 10,
  high: 20,
  minRatedEventsForAdaptation: 8,
  minTodayColdProbeAttemptsForSignal: 5,
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
    todayColdProbeAttempts: number
    todayIntroducedWords: number
    todayAcquiredWords: number
    coldProbePassRateToday: number | null
    ratedEvents30d: number
    againRate30d: number | null
    strainTier: LearnStatsSnapshot['strain']['tier']
    strainScore: number | null
    strainSamples: number
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
    stats.today.coldProbeAttempts >=
      policy.minTodayColdProbeAttemptsForSignal &&
    stats.today.coldProbePassRate !== null
  const weakAgain =
    ratedEvents >= policy.minRatedEventsForAdaptation &&
    againRate30d !== null &&
    againRate30d >= policy.weakAgainRatePct
  const moderateAgain =
    ratedEvents >= policy.minRatedEventsForAdaptation &&
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

  let tier: LearnAcquisitionQuotaTier = 'high'
  const reasonCodes: string[] = []

  if (weakAgain || weakCold) {
    tier = 'low'
    if (weakAgain) reasonCodes.push('high-again-rate')
    if (weakCold) reasonCodes.push('low-cold-probe-pass-rate')
  } else if (moderateAgain || moderateCold) {
    tier = 'medium'
    if (moderateAgain) reasonCodes.push('moderate-again-rate')
    if (moderateCold) reasonCodes.push('moderate-cold-probe-pass-rate')
  } else if (ratedEvents < policy.minRatedEventsForAdaptation) {
    reasonCodes.push('bootstrap-insufficient-rated-history')
    if (hasColdSignal) reasonCodes.push('strong-cold-probe-signal')
  } else {
    reasonCodes.push('stable-review-performance')
  }

  // Interaction strain is a one-way safety cap. It may slow new-word
  // admission, but low strain never pushes the learner above the memory-based
  // P3/P4 decision.
  if (stats.strain.tier === 'recovery') {
    tier = 'low'
    reasonCodes.push('interaction-strain-recovery')
  } else if (
    stats.strain.tier === 'elevated' &&
    tier === 'high'
  ) {
    tier = 'medium'
    reasonCodes.push('interaction-strain-elevated')
  }

  const targetDailyNewWords = policy[tier]
  const remainingBeforeUnseen = clampNonNegativeInteger(
    targetDailyNewWords - stats.today.introducedWords,
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
      todayColdProbeAttempts: stats.today.coldProbeAttempts,
      todayIntroducedWords: stats.today.introducedWords,
      todayAcquiredWords: stats.today.acquiredWords,
      coldProbePassRateToday: stats.today.coldProbePassRate,
      ratedEvents30d: ratedEvents,
      againRate30d,
      strainTier: stats.strain.tier,
      strainScore: stats.strain.score,
      strainSamples: stats.strain.sampleCount,
    },
  }
}
