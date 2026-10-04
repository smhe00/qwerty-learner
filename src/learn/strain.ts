import type { IWordRecord } from '@/utils/db/record'

export const LEARN_INTERACTION_STRAIN_POLICY_VERSION =
  'learn-interaction-strain-v2'

export const learnInteractionStrainPolicy = {
  maxRecentAttempts: 20,
  minAttemptsForDecision: 5,
  ewmaAlpha: 0.3,
  // Schmitt-trigger hysteresis. Entry thresholds are intentionally above
  // exit thresholds so small observer noise cannot cause tier chatter.
  elevatedEnterThreshold: 0.35,
  elevatedExitThreshold: 0.29,
  recoveryEnterThreshold: 0.58,
  recoveryExitThreshold: 0.5,
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


export function updateLearnInteractionStrainEwma(
  previous: number | null,
  input: number,
  alpha = learnInteractionStrainPolicy.ewmaAlpha,
): number {
  const boundedAlpha = clamp01(alpha)
  const boundedInput = clamp01(input)
  if (previous === null) return boundedInput
  return clamp01(
    boundedAlpha * boundedInput +
      (1 - boundedAlpha) * clamp01(previous),
  )
}

/**
 * Stateful tier resolver with hysteresis.
 *
 * The controller may escalate quickly, but de-escalation requires crossing a
 * lower threshold. Recovery must pass through elevated before low, providing
 * one discrete dwell step between large mode changes.
 */
export function resolveLearnInteractionStrainTier(
  score: number,
  previousTier: LearnInteractionStrainTier = 'unknown',
): LearnInteractionStrainTier {
  const value = clamp01(score)
  const policy = learnInteractionStrainPolicy

  if (previousTier === 'unknown') {
    if (value >= policy.recoveryEnterThreshold) return 'recovery'
    if (value >= policy.elevatedEnterThreshold) return 'elevated'
    return 'low'
  }

  if (previousTier === 'low') {
    if (value >= policy.recoveryEnterThreshold) return 'recovery'
    if (value >= policy.elevatedEnterThreshold) return 'elevated'
    return 'low'
  }

  if (previousTier === 'elevated') {
    if (value >= policy.recoveryEnterThreshold) return 'recovery'
    if (value <= policy.elevatedExitThreshold) return 'low'
    return 'elevated'
  }

  if (value <= policy.recoveryExitThreshold) return 'elevated'
  return 'recovery'
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
  if (left.timeStamp !== right.timeStamp) {
    return left.timeStamp - right.timeStamp
  }
  return (left.id ?? 0) - (right.id ?? 0)
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
  const recent = records
    .filter((record) => record.sourceMode === 'learn')
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
  let ewma: number | null = null
  let tier: LearnInteractionStrainTier = 'unknown'
  for (let index = 0; index < loads.length; index += 1) {
    ewma = updateLearnInteractionStrainEwma(ewma, loads[index].score)
    if (index + 1 >= policy.minAttemptsForDecision) {
      tier = resolveLearnInteractionStrainTier(ewma, tier)
    }
  }

  const score = round3(ewma ?? 0)

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
