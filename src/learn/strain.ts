import type { IWordRecord } from '@/utils/db/record'

export const LEARN_INTERACTION_STRAIN_POLICY_VERSION =
  'learn-interaction-strain-v1'

export const learnInteractionStrainPolicy = {
  maxRecentAttempts: 20,
  minAttemptsForDecision: 5,
  ewmaAlpha: 0.3,
  elevatedThreshold: 0.32,
  recoveryThreshold: 0.55,
  latencyFloorMs: 2_000,
  latencyCeilingMs: 8_000,
} as const

export type LearnInteractionStrainTier =
  | 'unknown'
  | 'low'
  | 'elevated'
  | 'recovery'

export type LearnInteractionStrainEstimate = {
  policyVersion: typeof LEARN_INTERACTION_STRAIN_POLICY_VERSION
  tier: LearnInteractionStrainTier
  score: number | null
  sampleCount: number
  targetSuccessProbability: number | null
  signals: {
    wrongLoad: number | null
    hintLoad: number | null
    latencyLoad: number | null
    correctionLoad: number | null
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function latencyLoad(record: IWordRecord): number | null {
  // Exposure intentionally invites listening/looking before typing. Its
  // first-key latency is therefore not a useful strain signal.
  if (
    record.reviewPolicyDecision?.policyVersion ===
    'learn-acquisition-exposure-v1'
  ) {
    return null
  }

  const latency = record.typingTelemetry?.firstKeyLatencyMs
  if (latency === undefined || !Number.isFinite(latency)) return null

  const policy = learnInteractionStrainPolicy
  return clamp01(
    (latency - policy.latencyFloorMs) /
      (policy.latencyCeilingMs - policy.latencyFloorMs),
  )
}

function attemptLoads(record: IWordRecord) {
  const wrongLoad = clamp01(record.wrongCount / 3)

  const hint = record.learningContext?.reviewHint
  const hintLoad = hint
    ? clamp01(0.35 + (hint.maxLevel / 3) * 0.65)
    : 0

  const latency = latencyLoad(record)

  const attempts = record.typingTelemetry?.attempts ?? []
  const wrongAttempts = attempts.filter(
    (attempt) => attempt.result === 'wrong',
  ).length
  const correctionLoad =
    attempts.length > 0
      ? clamp01(wrongAttempts / Math.min(3, attempts.length))
      : wrongLoad

  const available: Array<{ value: number; weight: number }> = [
    { value: wrongLoad, weight: 0.35 },
    { value: hintLoad, weight: 0.3 },
    { value: correctionLoad, weight: 0.2 },
  ]
  if (latency !== null) {
    available.push({ value: latency, weight: 0.15 })
  }

  const totalWeight = available.reduce(
    (sum, signal) => sum + signal.weight,
    0,
  )
  const score = available.reduce(
    (sum, signal) => sum + signal.value * signal.weight,
    0,
  ) / totalWeight

  return {
    score: clamp01(score),
    wrongLoad,
    hintLoad,
    latencyLoad: latency,
    correctionLoad,
  }
}

function recordOrder(left: IWordRecord, right: IWordRecord): number {
  const leftOrder = left.id ?? left.timeStamp
  const rightOrder = right.id ?? right.timeStamp
  return leftOrder - rightOrder
}

/**
 * Estimate observable interaction strain, not emotion.
 *
 * The estimator deliberately uses only Learn records supplied by its caller.
 * It never reads or mutates Typing state. The score is hidden product-control
 * data: it is intended to adjust workload/scaffolding without labelling the
 * learner as frustrated or weak.
 */
export function estimateLearnInteractionStrain(
  records: IWordRecord[],
): LearnInteractionStrainEstimate {
  const policy = learnInteractionStrainPolicy
  const recent = [...records]
    .sort(recordOrder)
    .slice(-policy.maxRecentAttempts)

  if (recent.length < policy.minAttemptsForDecision) {
    return {
      policyVersion: LEARN_INTERACTION_STRAIN_POLICY_VERSION,
      tier: 'unknown',
      score: null,
      sampleCount: recent.length,
      targetSuccessProbability: null,
      signals: {
        wrongLoad: null,
        hintLoad: null,
        latencyLoad: null,
        correctionLoad: null,
      },
    }
  }

  const loads = recent.map(attemptLoads)
  let ewma = loads[0].score
  for (let index = 1; index < loads.length; index += 1) {
    ewma =
      policy.ewmaAlpha * loads[index].score +
      (1 - policy.ewmaAlpha) * ewma
  }

  const score = round3(ewma)
  const tier: LearnInteractionStrainTier =
    score >= policy.recoveryThreshold
      ? 'recovery'
      : score >= policy.elevatedThreshold
        ? 'elevated'
        : 'low'

  return {
    policyVersion: LEARN_INTERACTION_STRAIN_POLICY_VERSION,
    tier,
    score,
    sampleCount: recent.length,
    targetSuccessProbability:
      tier === 'recovery' ? 0.9 : tier === 'elevated' ? 0.85 : 0.78,
    signals: {
      wrongLoad: mean(loads.map((item) => item.wrongLoad)),
      hintLoad: mean(loads.map((item) => item.hintLoad)),
      latencyLoad: mean(
        loads
          .map((item) => item.latencyLoad)
          .filter((value): value is number => value !== null),
      ),
      correctionLoad: mean(
        loads.map((item) => item.correctionLoad),
      ),
    },
  }
}
