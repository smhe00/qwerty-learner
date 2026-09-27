import { extractTypingBehaviorFeatures } from './features'
import type { WordHistorySummary } from './features'
import { typingClassifierPolicy } from './policy'
import type { LearningContextV1, WordRecordTelemetry } from '@/utils/db/record'

export type TypingErrorCause = 'clean' | 'recall' | 'spelling' | 'motor' | 'uncertain'

export type TypingErrorClassification = {
  cause: TypingErrorCause
  confidence: number
  attentionUncertain?: boolean
  scores: {
    recall: number
    spelling: number
    motor: number
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function normalize(value: number | undefined, low: number, high: number): number {
  if (value === undefined) return 0
  if (high <= low) return value >= high ? 1 : 0
  return clamp01((value - low) / (high - low))
}

function normalizedScores(recall: number, spelling: number, motor: number) {
  const total = recall + spelling + motor
  if (total <= 0) {
    return { recall: 1 / 3, spelling: 1 / 3, motor: 1 / 3 }
  }
  return {
    recall: recall / total,
    spelling: spelling / total,
    motor: motor / total,
  }
}

/**
 * Transparent v1 heuristic classifier. The output is deliberately probabilistic
 * and replaceable; raw telemetry remains the source of truth.
 */
export function classifyTypingError(input: {
  word: string
  wrongCount: number
  telemetry?: WordRecordTelemetry
  learningContext?: LearningContextV1
  history?: WordHistorySummary
}): TypingErrorClassification {
  const features = extractTypingBehaviorFeatures(input.word, input.wrongCount, input.telemetry, input.history)
  const hadPreInputLearningInteraction =
    input.learningContext?.revealedBeforeFirstKey === true ||
    input.learningContext?.meaningRevealedBeforeFirstKey === true ||
    input.learningContext?.pronunciationPlayedBeforeFirstKey === true

  const attentionUncertain =
    ((features.firstKeyLatencyMs ?? 0) >= typingClassifierPolicy.attentionUncertainFirstKeyMs &&
      !hadPreInputLearningInteraction) ||
    ((features.maxInterKeyMs ?? 0) >= typingClassifierPolicy.attentionUncertainInterKeyMs)

  if (input.wrongCount <= 0) {
    return {
      cause: 'clean',
      confidence: attentionUncertain ? 0.4 : 1,
      attentionUncertain: attentionUncertain || undefined,
      scores: { recall: 0, spelling: 0, motor: 0 },
    }
  }
  const firstKey = features.firstKeyLatencyMs
  const historySampleWeight = Math.min(1, (features.history?.recordCount ?? 0) / 5)
  const historyFailureRate = (features.history?.failureRate ?? 0) * historySampleWeight
  const historyDominantRatio = (features.history?.dominantWrongIndexRatio ?? 0) * historySampleWeight

  let recall =
    0.15 +
    0.55 * normalize(firstKey, typingClassifierPolicy.fastFirstKeyMs, typingClassifierPolicy.veryLongFirstKeyMs) +
    0.15 * normalize(features.wrongAttemptCount, 1, 3) +
    0.15 * normalize(features.uniqueWrongPositionCount, 1, 3) +
    0.15 * historyFailureRate

  let spelling =
    0.15 +
    0.45 * features.repeatedWrongPositionRatio +
    0.2 * normalize(features.maxInterKeyMs, typingClassifierPolicy.fastInterKeyMs, typingClassifierPolicy.slowInterKeyMs) +
    0.2 * historyDominantRatio +
    0.1 * historyFailureRate

  let motor =
    0.1 +
    0.55 * features.adjacentWrongRatio +
    (firstKey !== undefined && firstKey <= typingClassifierPolicy.fastFirstKeyMs ? 0.15 : 0) +
    (features.averageInterKeyMs !== undefined && features.averageInterKeyMs <= typingClassifierPolicy.fastInterKeyMs ? 0.1 : 0) +
    (features.wrongAttemptCount === 1 ? 0.15 : 0)

  if (features.adjacentWrongRatio >= typingClassifierPolicy.motorAdjacentRatio) {
    motor += 0.1
  }

  if (features.repeatedWrongPositionRatio >= 0.75 && features.wrongAttemptCount >= 2) {
    motor -= 0.2
    spelling += 0.15
  }

  if (firstKey !== undefined && firstKey >= typingClassifierPolicy.longFirstKeyMs) {
    motor -= 0.15
  }

  recall = Math.max(0.01, recall)
  spelling = Math.max(0.01, spelling)
  motor = Math.max(0.01, motor)

  const scores = normalizedScores(recall, spelling, motor)
  const ranked = (Object.entries(scores) as Array<[Exclude<TypingErrorCause, 'clean' | 'uncertain'>, number]>).sort(
    (a, b) => b[1] - a[1],
  )
  const [winner, winnerScore] = ranked[0]
  const runnerUpScore = ranked[1][1]

  if (
    attentionUncertain ||
    winnerScore < typingClassifierPolicy.uncertainConfidence ||
    winnerScore - runnerUpScore < typingClassifierPolicy.uncertainMargin
  ) {
    return {
      cause: 'uncertain',
      confidence: attentionUncertain ? Math.min(winnerScore, 0.49) : winnerScore,
      attentionUncertain: attentionUncertain || undefined,
      scores,
    }
  }

  return {
    cause: winner,
    confidence: winnerScore,
    scores,
  }
}
