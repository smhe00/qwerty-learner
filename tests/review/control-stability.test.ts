import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEARN_INTERACTION_STRAIN_POLICY_VERSION,
  learnInteractionStrainPolicy,
  resolveLearnInteractionStrainTier,
  updateLearnInteractionStrainEwma,
} from '../../src/learn/strain'
import type {
  LearnInteractionStrainEstimate,
  LearnInteractionStrainTier,
} from '../../src/learn/strain'
import { decideLearnScaffold } from '../../src/learn/scaffold'
import {
  createLearnAcquisitionState,
  decideLearnAcquisitionTransition,
} from '../../src/learn/acquisition'
import {
  learnRecoveryWindowPolicy,
  planLearnRecoveryWindow,
} from '../../src/learn/recovery-window'
import {
  decideDailyAcquisitionQuota,
  learnAcquisitionQuotaPolicy,
} from '../../src/learn/quota'
import type { LearnStatsSnapshot } from '../../src/learn/stats'

const CONTROL_STABILITY_GATE_VERSION = 'learn-control-stability-v1'

const efficiencyEnvelope = {
  maxCleanRecoveryAttempts: 12,
  maxVirtualPostStressRecoveryAttempts: 30,
  minIndependentOpportunityRatio: 0.52,
  minIndependentSuccessRate: 0.68,
  minMasteryYieldPerInteraction: 0.4,
  maxInterventionRatio: 0.48,
} as const

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function makeStrainEstimate(
  tier: LearnInteractionStrainTier,
): LearnInteractionStrainEstimate {
  const score =
    tier === 'recovery'
      ? 0.7
      : tier === 'elevated'
        ? 0.42
        : tier === 'low'
          ? 0.18
          : null

  return {
    policyVersion: LEARN_INTERACTION_STRAIN_POLICY_VERSION,
    tier,
    score,
    sampleCount: tier === 'unknown' ? 0 : 20,
    targetSuccessProbability:
      tier === 'recovery'
        ? 0.9
        : tier === 'elevated'
          ? 0.85
          : tier === 'low'
            ? 0.78
            : null,
    signals: {
      wrongLoad: score,
      hintLoad: score,
      latencyLoad: score,
      correctionLoad: score,
    },
  }
}

function makeStats(input: {
  strainTier: LearnInteractionStrainTier
  due?: number
  unseen?: number | null
  acquired?: number
  introduced?: number
  coldProbeAttempts?: number
  coldProbePassRate?: number | null
  ratedEvents30d?: number
  again30d?: number
}): LearnStatsSnapshot {
  const ratedEvents30d = input.ratedEvents30d ?? 0
  return {
    generatedAt: 0,
    today: {
      reviewedWords: 0,
      reviewAttempts: 0,
      coldProbeAttempts: input.coldProbeAttempts ?? 0,
      introducedWords: input.introduced ?? input.acquired ?? 0,
      acquiredWords: input.acquired ?? 0,
      hintUseRate: null,
      coldProbePassRate: input.coldProbePassRate ?? null,
    },
    lifecycle: {
      active: 0,
      due: input.due ?? 0,
      difficultDue: 0,
      excluded: 0,
      unseen: input.unseen ?? 100,
    },
    effort: {
      todayActiveSeconds: 0,
      medianReviewSeconds: null,
      medianAcquisitionSeconds: null,
      recentReviewSamples: 0,
      recentAcquisitionSamples: 0,
    },
    strain: makeStrainEstimate(input.strainTier),
    scheduler: {
      averageIntervalDays: null,
      successRate30d: null,
      ratedEvents30d,
      ratings30d: {
        again: Math.min(input.again30d ?? 0, ratedEvents30d),
        hard: 0,
        good: Math.max(
          0,
          ratedEvents30d - (input.again30d ?? 0),
        ),
        easy: 0,
      },
    },
    dailyActivity30d: [],
  }
}

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

test('control/BIBO: EWMA observer stays bounded and its pole decays', () => {
  assert.equal(CONTROL_STABILITY_GATE_VERSION, 'learn-control-stability-v1')
  assert.equal(learnInteractionStrainPolicy.ewmaAlpha, 0.3)

  let value: number | null = null
  const inputs = [-4, 0, 0.2, 0.8, 1, 4]
  for (let index = 0; index < 1_000; index += 1) {
    value = updateLearnInteractionStrainEwma(
      value,
      inputs[index % inputs.length],
    )
    assert.ok(value >= 0 && value <= 1)
  }

  value = 1
  for (let index = 0; index < 20; index += 1) {
    value = updateLearnInteractionStrainEwma(value, 0)
  }
  assert.ok(value < 0.001)
})

test('control/no-chatter: hysteresis rejects boundary oscillation', () => {
  let tier: LearnInteractionStrainTier = 'low'

  for (let index = 0; index < 100; index += 1) {
    tier = resolveLearnInteractionStrainTier(
      index % 2 === 0 ? 0.31 : 0.33,
      tier,
    )
    assert.equal(tier, 'low')
  }

  tier = resolveLearnInteractionStrainTier(0.36, tier)
  assert.equal(tier, 'elevated')

  for (let index = 0; index < 100; index += 1) {
    tier = resolveLearnInteractionStrainTier(
      index % 2 === 0 ? 0.31 : 0.33,
      tier,
    )
    assert.equal(tier, 'elevated')
  }

  tier = resolveLearnInteractionStrainTier(0.28, tier)
  assert.equal(tier, 'low')

  tier = resolveLearnInteractionStrainTier(0.6, tier)
  assert.equal(tier, 'recovery')
  tier = resolveLearnInteractionStrainTier(0.54, tier)
  assert.equal(tier, 'recovery')
  tier = resolveLearnInteractionStrainTier(0.49, tier)
  assert.equal(tier, 'elevated')
  tier = resolveLearnInteractionStrainTier(0.28, tier)
  assert.equal(tier, 'low')
})

test('control/efficiency: protection withdraws within bounded clean attempts', () => {
  let observer: number | null = null
  let tier: LearnInteractionStrainTier = 'unknown'

  for (let index = 0; index < 12; index += 1) {
    observer = updateLearnInteractionStrainEwma(observer, 1)
    if (index + 1 >= learnInteractionStrainPolicy.minAttemptsForDecision) {
      tier = resolveLearnInteractionStrainTier(observer, tier)
    }
  }
  assert.equal(tier, 'recovery')

  let cleanAttempts = 0
  while (
    tier !== 'low' &&
    cleanAttempts < efficiencyEnvelope.maxCleanRecoveryAttempts
  ) {
    observer = updateLearnInteractionStrainEwma(observer, 0)
    tier = resolveLearnInteractionStrainTier(observer, tier)
    cleanAttempts += 1
  }

  assert.equal(tier, 'low')
  assert.ok(
    cleanAttempts <= efficiencyEnvelope.maxCleanRecoveryAttempts,
  )

  const supported = decideLearnScaffold({
    phase: 'supported',
    strainTier: tier,
    assistedCycles: 0,
  })
  assert.equal(supported.level, 'S2')
})

test('control/finite-termination: repeated acquisition failure cannot loop forever', () => {
  let state = createLearnAcquisitionState({
    scaffoldStrainTier: 'recovery',
  })
  let transitions = 0

  state = decideLearnAcquisitionTransition(state, {
    kind: 'exposure-complete',
  })
  transitions += 1
  state = decideLearnAcquisitionTransition(state, {
    kind: 'guided-committed',
  })
  transitions += 1

  while (state.phase !== 'complete' && state.phase !== 'deferred') {
    if (state.phase === 'supported') {
      state = decideLearnAcquisitionTransition(state, {
        kind: 'supported-complete',
      })
    } else if (state.phase === 'independent') {
      state = decideLearnAcquisitionTransition(state, {
        kind: 'independent-complete',
        independentClean: false,
        scaffoldHintPosition: 2,
      })
    } else {
      throw new Error(`unexpected phase: ${state.phase}`)
    }
    transitions += 1
    assert.ok(transitions <= 8)
  }

  assert.equal(state.phase, 'deferred')
  assert.equal(state.assistedCycles, 2)
})

test('control/recovery: window is bounded and cannot recursively select Independent work', () => {
  const queue = ['target', 'a', 'b', 'c', 'd'].map((name) => ({
    name,
  }))
  const target = {
    ...createLearnAcquisitionState({
      scaffoldStrainTier: 'recovery',
    }),
    phase: 'supported' as const,
    assistedCycles: 1,
  }
  const states = {
    target,
    a: createLearnAcquisitionState({
      scaffoldStrainTier: 'recovery',
    }),
    b: {
      ...createLearnAcquisitionState({
        scaffoldStrainTier: 'recovery',
      }),
      phase: 'independent' as const,
    },
    c: {
      ...createLearnAcquisitionState({
        scaffoldStrainTier: 'recovery',
      }),
      phase: 'supported' as const,
      assistedCycles: 1,
    },
    d: createLearnAcquisitionState({
      scaffoldStrainTier: 'recovery',
    }),
  }

  const plan = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: target,
    acquisitionStates: states,
  })

  assert.ok(
    plan.selectedNames.length <=
      learnRecoveryWindowPolicy.recoveryItems,
  )
  assert.equal(plan.selectedNames.includes('b'), false)
  assert.deepEqual(plan.selectedNames, ['a', 'c', 'd'])
})

test('control/quota: workload actuator is saturated and due remains dominant', () => {
  const tiers: LearnInteractionStrainTier[] = [
    'unknown',
    'low',
    'elevated',
    'recovery',
  ]

  for (const strainTier of tiers) {
    for (let due = 0; due <= 50; due += 5) {
      for (let acquired = 0; acquired <= 30; acquired += 3) {
        const decision = decideDailyAcquisitionQuota(
          makeStats({
            strainTier,
            due,
            acquired,
            unseen: 200,
          }),
        )

        assert.ok(decision.targetDailyNewWords >= 0)
        assert.ok(
          decision.targetDailyNewWords <=
            learnAcquisitionQuotaPolicy.high,
        )
        assert.ok(decision.allowedNow >= 0)
        assert.ok(
          decision.allowedNow <=
            learnAcquisitionQuotaPolicy.high,
        )
        if (due > 0) assert.equal(decision.allowedNow, 0)
      }
    }
  }
})

test('control/backlog: due-first policy clears bounded burst arrivals', () => {
  let backlog = 0
  let maxBacklog = 0
  const serviceCapacity = 10
  const arrivals = [24, 4, 4, 4]

  for (let day = 0; day < 120; day += 1) {
    backlog += arrivals[day % arrivals.length]
    const quota = decideDailyAcquisitionQuota(
      makeStats({
        strainTier: 'low',
        due: backlog,
        unseen: 1_000,
      }),
    )
    assert.equal(quota.allowedNow, 0)

    backlog = Math.max(0, backlog - serviceCapacity)
    maxBacklog = Math.max(maxBacklog, backlog)
  }

  assert.ok(maxBacklog <= 14)
  assert.equal(backlog, 0)

  const resumed = decideDailyAcquisitionQuota(
    makeStats({
      strainTier: 'low',
      due: 0,
      unseen: 1_000,
    }),
  )
  assert.ok(resumed.allowedNow > 0)
})

type VirtualLearnerMetrics = {
  independentAttempts: number
  independentSuccesses: number
  totalInteractions: number
  recoveryInteractions: number
  supportInteractions: number
  finalMemory: number
  recoveryToLowAttempts: number
}

function simulateVirtualLearner(seed: number): VirtualLearnerMetrics {
  const random = createRng(seed)
  let memory = 0.58 + 0.14 * random()
  let observer: number | null = null
  let tier: LearnInteractionStrainTier = 'unknown'
  let independentAttempts = 0
  let independentSuccesses = 0
  let totalInteractions = 0
  let recoveryInteractions = 0
  let supportInteractions = 0
  let recoveryToLowAttempts = -1

  for (let step = 0; step < 220; step += 1) {
    const inStressWindow = step >= 70 && step < 100
    const exogenousStrain = inStressWindow
      ? 0.9
      : 0.08 + 0.12 * random()
    const difficulty = 0.3 + 0.45 * random()
    const successProbability = logistic(
      5 * (memory - difficulty - 0.22 * exogenousStrain),
    )
    const independentSuccess = random() < successProbability

    independentAttempts += 1
    totalInteractions += 1
    if (independentSuccess) independentSuccesses += 1

    const observedLoad = clamp01(
      (independentSuccess ? 0 : 0.62) +
        0.28 * exogenousStrain +
        0.1 * difficulty,
    )
    observer = updateLearnInteractionStrainEwma(
      observer,
      observedLoad,
    )
    if (
      step + 1 >=
      learnInteractionStrainPolicy.minAttemptsForDecision
    ) {
      tier = resolveLearnInteractionStrainTier(observer, tier)
    }

    if (
      step >= 100 &&
      recoveryToLowAttempts < 0 &&
      tier === 'low'
    ) {
      recoveryToLowAttempts = step - 100
    }

    if (independentSuccess) {
      memory += 0.011 * (1 - memory)
    } else {
      const nextState = {
        ...createLearnAcquisitionState({
          scaffoldStrainTier: tier,
        }),
        phase: 'supported' as const,
        assistedCycles: 1,
      }
      const recoveryQueue = [
        { name: 'target' },
        { name: 'r1' },
        { name: 'r2' },
        { name: 'r3' },
      ]
      const recoveryPlan = planLearnRecoveryWindow({
        queue: recoveryQueue,
        currentIndex: 0,
        currentWord: recoveryQueue[0],
        nextState,
        acquisitionStates: {
          target: nextState,
          r1: createLearnAcquisitionState({
            scaffoldStrainTier: tier,
          }),
          r2: createLearnAcquisitionState({
            scaffoldStrainTier: tier,
          }),
          r3: createLearnAcquisitionState({
            scaffoldStrainTier: tier,
          }),
        },
      })

      recoveryInteractions += recoveryPlan.selectedNames.length
      totalInteractions += recoveryPlan.selectedNames.length

      const scaffold = decideLearnScaffold({
        phase: 'supported',
        strainTier: tier,
        assistedCycles: 1,
      })
      assert.equal(scaffold.level, 'S1')
      supportInteractions += 1
      totalInteractions += 1

      memory += 0.0085 * (1 - memory)
    }

    memory = Math.max(
      0.35,
      memory - 0.0015 * difficulty,
    )
  }

  return {
    independentAttempts,
    independentSuccesses,
    totalInteractions,
    recoveryInteractions,
    supportInteractions,
    finalMemory: memory,
    recoveryToLowAttempts,
  }
}

test('control/virtual-learner: Monte Carlo closed loop stays stable and efficient', () => {
  const metrics = Array.from({ length: 64 }, (_, index) =>
    simulateVirtualLearner(index + 1),
  )

  const totalIndependent = metrics.reduce(
    (sum, item) => sum + item.independentAttempts,
    0,
  )
  const totalSuccesses = metrics.reduce(
    (sum, item) => sum + item.independentSuccesses,
    0,
  )
  const totalInteractions = metrics.reduce(
    (sum, item) => sum + item.totalInteractions,
    0,
  )
  const totalInterventions = metrics.reduce(
    (sum, item) =>
      sum +
      item.recoveryInteractions +
      item.supportInteractions,
    0,
  )

  const independentOpportunityRatio =
    totalIndependent / totalInteractions
  const independentSuccessRate =
    totalSuccesses / totalIndependent
  const masteryYieldPerInteraction =
    totalSuccesses / totalInteractions
  const interventionRatio =
    totalInterventions / totalInteractions

  assert.ok(
    independentOpportunityRatio >=
      efficiencyEnvelope.minIndependentOpportunityRatio,
  )
  assert.ok(
    independentSuccessRate >=
      efficiencyEnvelope.minIndependentSuccessRate,
  )
  assert.ok(
    masteryYieldPerInteraction >=
      efficiencyEnvelope.minMasteryYieldPerInteraction,
  )
  assert.ok(
    interventionRatio <=
      efficiencyEnvelope.maxInterventionRatio,
  )

  for (const item of metrics) {
    assert.ok(item.finalMemory >= 0.35 && item.finalMemory <= 1)
    assert.ok(item.recoveryInteractions <= item.independentAttempts * 3)
    assert.ok(
      item.recoveryToLowAttempts >= 0 &&
        item.recoveryToLowAttempts <=
          efficiencyEnvelope.maxVirtualPostStressRecoveryAttempts,
    )
  }
})
