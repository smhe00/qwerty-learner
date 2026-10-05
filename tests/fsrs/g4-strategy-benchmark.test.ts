import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FSRS6_DEFAULT_STRATEGY,
  FSRS6_G4_CANDIDATE_STRATEGY,
} from '../../src/review/fsrs/strategy'
import {
  LEARNER_PERSONAS,
  SIMULATION_BASIC_V2_STRATEGY,
  simulateLearner,
  type SimulationReviewStrategy,
} from '../simulation/learner-simulator'

const RETENTION_SWEEP = [0.84, 0.86, 0.88, 0.9, 0.92, 0.94] as const
const SEEDS = [11, 23, 37, 51, 67, 83] as const
const LONG_HORIZON_SEEDS = [11, 37, 67] as const
const DAYS = 120
const LONG_HORIZON_DAYS = 365
const DICTIONARY_SIZE = 240

const MIN_EFFICIENCY_GAIN_FOR_PROMOTION = 0.05
const MAX_RETENTION_DROP = 0.005
const MAX_P95_WORKLOAD_MULTIPLIER = 1.05
const MAX_PERSONA_EFFICIENCY_DROP = 0.03

type StrategySummary = {
  id: string
  kind: SimulationReviewStrategy['kind']
  requestRetention: number | null
  runs: number
  meanEfficiency: number
  meanRetention30d: number
  meanMasteredWords: number
  meanDailyInteractions: number
  meanP95DailyInteractions: number
  maxDueBacklog: number
  personaEfficiency: Record<string, number>
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function fsrsStrategyForRetention(
  requestRetention: number,
): SimulationReviewStrategy {
  if (
    requestRetention ===
    FSRS6_DEFAULT_STRATEGY.requestRetention
  ) {
    return {
      ...FSRS6_DEFAULT_STRATEGY,
      kind: 'fsrs6',
    }
  }
  if (
    requestRetention ===
    FSRS6_G4_CANDIDATE_STRATEGY.requestRetention
  ) {
    return {
      ...FSRS6_G4_CANDIDATE_STRATEGY,
      kind: 'fsrs6',
    }
  }
  return {
    id: `fsrs6-default-r${requestRetention.toFixed(2)}`,
    kind: 'fsrs6',
    requestRetention,
  }
}

function strategyCandidates(): SimulationReviewStrategy[] {
  return [
    SIMULATION_BASIC_V2_STRATEGY,
    ...RETENTION_SWEEP.map(fsrsStrategyForRetention),
  ]
}

function summarize(
  strategy: SimulationReviewStrategy,
  options: {
    seeds?: readonly number[]
    days?: number
    dictionarySize?: number
  } = {},
): StrategySummary {
  const seeds = options.seeds ?? SEEDS
  const days = options.days ?? DAYS
  const dictionarySize =
    options.dictionarySize ?? DICTIONARY_SIZE
  const runs = Object.values(LEARNER_PERSONAS).flatMap((persona) =>
    seeds.map((seed) =>
      simulateLearner({
        persona,
        seed,
        days,
        dictionarySize,
        reviewStrategy: strategy,
      }),
    ),
  )

  const efficiencies = runs.map((run) => {
    const totalInteractions = run.daily.reduce(
      (sum, day) => sum + day.interactions,
      0,
    )
    return totalInteractions === 0
      ? 0
      : run.metrics.masteredWords / totalInteractions
  })
  const retention = runs.map(
    (run) => run.metrics.retentionAfter30d ?? 0,
  )
  const personaEfficiency: Record<string, number> = {}

  for (const persona of Object.values(LEARNER_PERSONAS)) {
    const matching = runs.filter(
      (run) => run.persona.id === persona.id,
    )
    personaEfficiency[persona.id] = round6(
      mean(
        matching.map((run) => {
          const totalInteractions = run.daily.reduce(
            (sum, day) => sum + day.interactions,
            0,
          )
          return totalInteractions === 0
            ? 0
            : run.metrics.masteredWords / totalInteractions
        }),
      ),
    )
  }

  return {
    id: strategy.id,
    kind: strategy.kind,
    requestRetention:
      strategy.kind === 'fsrs6'
        ? strategy.requestRetention
        : null,
    runs: runs.length,
    meanEfficiency: round6(mean(efficiencies)),
    meanRetention30d: round6(mean(retention)),
    meanMasteredWords: round6(
      mean(runs.map((run) => run.metrics.masteredWords)),
    ),
    meanDailyInteractions: round6(
      mean(runs.map((run) => run.metrics.meanDailyInteractions)),
    ),
    meanP95DailyInteractions: round6(
      mean(runs.map((run) => run.metrics.p95DailyInteractions)),
    ),
    maxDueBacklog: Math.max(
      ...runs.map((run) => run.metrics.maxDueBacklog),
    ),
    personaEfficiency,
  }
}

function relativeGain(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : Infinity
  return candidate / baseline - 1
}

test('G4 benchmark compares basic-v2 and FSRS-6 retention candidates with an explicit promotion gate', () => {
  const summaries = strategyCandidates().map(summarize)
  const basic = summaries.find((item) => item.id === 'basic-v2')
  const fsrsDefault = summaries.find(
    (item) => item.id === FSRS6_DEFAULT_STRATEGY.id,
  )

  if (!basic || !fsrsDefault) {
    throw new Error('benchmark baselines are missing')
  }

  for (const summary of summaries) {
    assert.equal(
      summary.runs,
      Object.keys(LEARNER_PERSONAS).length * SEEDS.length,
    )
    assert.ok(Number.isFinite(summary.meanEfficiency))
    assert.ok(summary.meanEfficiency >= 0)
    assert.ok(summary.meanRetention30d >= 0)
    assert.ok(summary.meanRetention30d <= 1)
    assert.ok(summary.meanP95DailyInteractions >= 0)
    assert.ok(summary.maxDueBacklog >= 0)
  }

  const eligible = summaries
    .filter(
      (summary) =>
        summary.kind === 'fsrs6' &&
        summary.id !== fsrsDefault.id,
    )
    .map((summary) => {
      const efficiencyGain = relativeGain(
        summary.meanEfficiency,
        fsrsDefault.meanEfficiency,
      )
      const retentionDelta =
        summary.meanRetention30d - fsrsDefault.meanRetention30d
      const p95WorkloadRatio =
        fsrsDefault.meanP95DailyInteractions === 0
          ? 1
          : summary.meanP95DailyInteractions /
            fsrsDefault.meanP95DailyInteractions
      const worstPersonaEfficiencyDelta = Math.min(
        ...Object.keys(fsrsDefault.personaEfficiency).map((persona) =>
          relativeGain(
            summary.personaEfficiency[persona],
            fsrsDefault.personaEfficiency[persona],
          ),
        ),
      )
      const beatsBasic =
        summary.meanEfficiency >= basic.meanEfficiency &&
        summary.meanRetention30d >=
          basic.meanRetention30d - MAX_RETENTION_DROP

      return {
        summary,
        efficiencyGain,
        retentionDelta,
        p95WorkloadRatio,
        worstPersonaEfficiencyDelta,
        beatsBasic,
        promotable:
          efficiencyGain >= MIN_EFFICIENCY_GAIN_FOR_PROMOTION &&
          retentionDelta >= -MAX_RETENTION_DROP &&
          p95WorkloadRatio <= MAX_P95_WORKLOAD_MULTIPLIER &&
          worstPersonaEfficiencyDelta >=
            -MAX_PERSONA_EFFICIENCY_DROP &&
          beatsBasic,
      }
    })
    .sort(
      (left, right) =>
        right.summary.meanEfficiency -
        left.summary.meanEfficiency,
    )

  const best = eligible[0] ?? null
  const promoted =
    eligible.find((candidate) => candidate.promotable) ?? null

  console.log(
    'SIM_FSRS_G4_BENCHMARK',
    JSON.stringify({
      policy: {
        minEfficiencyGainForPromotion:
          MIN_EFFICIENCY_GAIN_FOR_PROMOTION,
        maxRetentionDrop: MAX_RETENTION_DROP,
        maxP95WorkloadMultiplier:
          MAX_P95_WORKLOAD_MULTIPLIER,
        maxPersonaEfficiencyDrop:
          MAX_PERSONA_EFFICIENCY_DROP,
      },
      basic,
      fsrsDefault,
      candidates: eligible,
      bestCandidate: best,
      decision: promoted
        ? {
            action: 'promote-candidate',
            candidateId: promoted.summary.id,
          }
        : {
            action: 'hold',
            candidateId: best?.summary.id ?? null,
          },
    }),
  )

  if (promoted) {
    assert.ok(
      promoted.summary.meanEfficiency > fsrsDefault.meanEfficiency,
    )
  }
})

test('G4 selected r0.88 candidate keeps its advantage over 365 simulated days', () => {
  const strategies: SimulationReviewStrategy[] = [
    SIMULATION_BASIC_V2_STRATEGY,
    {
      ...FSRS6_DEFAULT_STRATEGY,
      kind: 'fsrs6',
    },
    {
      ...FSRS6_G4_CANDIDATE_STRATEGY,
      kind: 'fsrs6',
    },
  ]
  const summaries = strategies.map((strategy) =>
    summarize(strategy, {
      seeds: LONG_HORIZON_SEEDS,
      days: LONG_HORIZON_DAYS,
      dictionarySize: DICTIONARY_SIZE,
    }),
  )
  const basic = summaries.find(
    (item) => item.id === SIMULATION_BASIC_V2_STRATEGY.id,
  )
  const fsrsDefault = summaries.find(
    (item) => item.id === FSRS6_DEFAULT_STRATEGY.id,
  )
  const candidate = summaries.find(
    (item) => item.id === FSRS6_G4_CANDIDATE_STRATEGY.id,
  )
  if (!basic || !fsrsDefault || !candidate) {
    throw new Error('365-day benchmark baselines are missing')
  }

  const efficiencyGain = relativeGain(
    candidate.meanEfficiency,
    fsrsDefault.meanEfficiency,
  )
  const retentionDelta =
    candidate.meanRetention30d - fsrsDefault.meanRetention30d
  const p95WorkloadRatio =
    fsrsDefault.meanP95DailyInteractions === 0
      ? 1
      : candidate.meanP95DailyInteractions /
        fsrsDefault.meanP95DailyInteractions
  const worstPersonaEfficiencyDelta = Math.min(
    ...Object.keys(fsrsDefault.personaEfficiency).map((persona) =>
      relativeGain(
        candidate.personaEfficiency[persona],
        fsrsDefault.personaEfficiency[persona],
      ),
    ),
  )

  console.log(
    'SIM_FSRS_G4_365D',
    JSON.stringify({
      basic,
      fsrsDefault,
      candidate,
      efficiencyGain,
      retentionDelta,
      p95WorkloadRatio,
      worstPersonaEfficiencyDelta,
    }),
  )

  assert.ok(
    efficiencyGain >= MIN_EFFICIENCY_GAIN_FOR_PROMOTION,
  )
  assert.ok(retentionDelta >= -MAX_RETENTION_DROP)
  assert.ok(
    p95WorkloadRatio <= MAX_P95_WORKLOAD_MULTIPLIER,
  )
  assert.ok(
    worstPersonaEfficiencyDelta >=
      -MAX_PERSONA_EFFICIENCY_DROP,
  )
  assert.ok(candidate.meanEfficiency >= basic.meanEfficiency)
  assert.ok(
    candidate.meanRetention30d >=
      basic.meanRetention30d - MAX_RETENTION_DROP,
  )
})
