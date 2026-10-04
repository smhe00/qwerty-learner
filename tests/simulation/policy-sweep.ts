import {
  learnAcquisitionQuotaPolicy,
  type LearnAcquisitionQuotaPolicy,
} from '../../src/learn/quota'
import {
  defaultBasicReviewSchedulePolicy,
  type BasicReviewSchedulePolicy,
} from '../../src/review/scheduler'
import {
  LEARNER_PERSONAS,
  simulateLearner,
  type LearnerPersona,
  type LearnerSimulationResult,
} from './learner-simulator'

export type SimulationPolicyCandidate = {
  id: string
  schedulePolicy: BasicReviewSchedulePolicy
  quotaPolicy: LearnAcquisitionQuotaPolicy
}

export type PolicySweepSummary = {
  candidateId: string
  score: number
  meanRetention30d: number
  meanMasteryRate: number
  meanLapseRate: number
  meanDailyInteractions: number
  maxDueBacklog: number
}

function cloneQuota(
  patch: Partial<LearnAcquisitionQuotaPolicy>,
): LearnAcquisitionQuotaPolicy {
  return {
    ...learnAcquisitionQuotaPolicy,
    ...patch,
  }
}

export const DEFAULT_SIMULATION_POLICY_CANDIDATES:
  SimulationPolicyCandidate[] = [
    {
      id: 'baseline',
      schedulePolicy: defaultBasicReviewSchedulePolicy,
      quotaPolicy: learnAcquisitionQuotaPolicy,
    },
    {
      id: 'retention-first',
      schedulePolicy: {
        intervalsDays: [1, 2, 5, 10, 21, 45, 90, 150],
        sameSessionWindowSeconds:
          defaultBasicReviewSchedulePolicy.sameSessionWindowSeconds,
      },
      quotaPolicy: cloneQuota({
        low: 4,
        medium: 8,
        high: 16,
      }),
    },
    {
      id: 'load-first',
      schedulePolicy: {
        intervalsDays: [1, 4, 10, 21, 45, 90, 150, 240],
        sameSessionWindowSeconds:
          defaultBasicReviewSchedulePolicy.sameSessionWindowSeconds,
      },
      quotaPolicy: cloneQuota({
        low: 5,
        medium: 10,
        high: 20,
      }),
    },
  ]

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Provisional synthetic objective.
 *
 * This is deliberately not a product KPI contract. It is only a ranking
 * function for simulation candidates until persona parameters are calibrated
 * against real Qwerty Plus learning traces.
 */
export function scoreSimulationRuns(
  runs: LearnerSimulationResult[],
): PolicySweepSummary {
  const meanRetention30d = mean(
    runs.map((run) => run.metrics.retentionAfter30d ?? 0),
  )
  const meanMasteryRate = mean(
    runs.map((run) => run.metrics.masteryRate),
  )
  const meanLapseRate = mean(
    runs.map((run) => run.metrics.lapseRate),
  )
  const meanDailyInteractions = mean(
    runs.map((run) => run.metrics.meanDailyInteractions),
  )
  const maxDueBacklog = Math.max(
    0,
    ...runs.map((run) => run.metrics.maxDueBacklog),
  )

  const workloadPenalty = Math.min(
    1,
    meanDailyInteractions / 80,
  )
  const backlogPenalty = Math.min(1, maxDueBacklog / 80)

  return {
    candidateId: '',
    score:
      0.45 * meanRetention30d +
      0.35 * meanMasteryRate -
      0.1 * meanLapseRate -
      0.08 * workloadPenalty -
      0.02 * backlogPenalty,
    meanRetention30d,
    meanMasteryRate,
    meanLapseRate,
    meanDailyInteractions,
    maxDueBacklog,
  }
}

export function runPolicySweep(input?: {
  candidates?: SimulationPolicyCandidate[]
  personas?: LearnerPersona[]
  seeds?: number[]
  days?: number
  dictionarySize?: number
}): PolicySweepSummary[] {
  const candidates =
    input?.candidates ?? DEFAULT_SIMULATION_POLICY_CANDIDATES
  const personas =
    input?.personas ?? [
      LEARNER_PERSONAS.strong,
      LEARNER_PERSONAS.balanced,
      LEARNER_PERSONAS.weakMemory,
      LEARNER_PERSONAS.highFatigue,
    ]
  const seeds = input?.seeds ?? [11, 23, 37]
  const days = input?.days ?? 120
  const dictionarySize = input?.dictionarySize ?? 240

  return candidates
    .map((candidate) => {
      const runs: LearnerSimulationResult[] = []

      for (const persona of personas) {
        for (const seed of seeds) {
          runs.push(
            simulateLearner({
              persona,
              seed,
              days,
              dictionarySize,
              schedulePolicy: candidate.schedulePolicy,
              quotaPolicy: candidate.quotaPolicy,
            }),
          )
        }
      }

      return {
        ...scoreSimulationRuns(runs),
        candidateId: candidate.id,
      }
    })
    .sort((left, right) => right.score - left.score)
}
