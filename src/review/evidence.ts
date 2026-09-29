import type { TypingErrorCause, TypingErrorClassification } from './classifier'
import type { ReviewObservation } from './observation'
import { typingClassifierPolicy } from './policy'
import type { ReviewOutcome } from './types'

export const REVIEW_EVIDENCE_VERSION = 1 as const

export type RetrievalValidity = 'independent' | 'assisted' | 'uncertain' | 'unknown'

export type ReviewEvidenceV1 = {
  version: typeof REVIEW_EVIDENCE_VERSION
  memoryGrade: ReviewOutcome
  errorCause: TypingErrorCause
  confidence: number
  evidenceStrength: number
  retrievalValidity: RetrievalValidity
  reasonCodes: string[]
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function answerVisibility(observation: ReviewObservation) {
  if (observation.exerciseCondition) {
    const mode = observation.exerciseCondition.letters.mode
    if (mode === 'all-hidden') return 'hidden'
    if (mode === 'all-visible') return 'full'
    return 'partial'
  }

  return observation.learningContext?.answerVisibilityAtStart
}

function audioCondition(observation: ReviewObservation) {
  if (observation.exerciseCondition) return observation.exerciseCondition.audio
  if (observation.learningContext?.pronunciationEnabledAtStart === false) return 'none'
  return undefined
}

function assistanceReasons(observation: ReviewObservation): string[] {
  const reasons: string[] = []
  const context = observation.learningContext

  if (context?.revealedBeforeFirstKey) reasons.push('answer-revealed-before-first-key')
  if (context?.meaningRevealedBeforeFirstKey) reasons.push('meaning-revealed-before-first-key')

  return reasons
}

/**
 * Evidence V2 shadow model.
 *
 * It deliberately separates memory grade from evidence strength. The current
 * scheduler does not consume this result yet; this lets us validate semantics
 * before changing due dates.
 */
export function evaluateReviewEvidence(
  observation: ReviewObservation,
  classification: TypingErrorClassification,
): ReviewEvidenceV1 {
  const confidence = clamp01(classification.confidence)
  const reasons: string[] = []

  if (classification.attentionUncertain) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'hard',
      errorCause: classification.cause,
      confidence,
      evidenceStrength: Math.min(confidence, 0.35),
      retrievalValidity: 'uncertain',
      reasonCodes: ['attention-uncertain'],
    }
  }

  if (classification.cause !== 'clean') {
    if (classification.cause === 'recall') {
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'again',
        errorCause: 'recall',
        confidence,
        evidenceStrength: confidence,
        retrievalValidity: 'independent',
        reasonCodes: ['recall-failure'],
      }
    }

    if (classification.cause === 'spelling') {
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'hard',
        errorCause: 'spelling',
        confidence,
        evidenceStrength: confidence,
        retrievalValidity: 'independent',
        reasonCodes: ['spelling-weakness'],
      }
    }

    if (classification.cause === 'motor') {
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'good',
        errorCause: 'motor',
        confidence,
        evidenceStrength: Math.max(0.5, confidence),
        retrievalValidity: 'independent',
        reasonCodes: ['motor-error-not-memory-failure'],
      }
    }

    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'hard',
      errorCause: classification.cause,
      confidence,
      evidenceStrength: Math.min(confidence, 0.5),
      retrievalValidity: 'uncertain',
      reasonCodes: ['error-cause-uncertain'],
    }
  }

  const assistance = assistanceReasons(observation)
  if (assistance.length > 0) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'hard',
      errorCause: 'clean',
      confidence,
      evidenceStrength: Math.min(confidence, 0.35),
      retrievalValidity: 'assisted',
      reasonCodes: dedupe(['clean-after-assistance', ...assistance]),
    }
  }

  const visibility = answerVisibility(observation)
  const audio = audioCondition(observation)
  const firstKeyLatencyMs = observation.typingTelemetry?.firstKeyLatencyMs

  if (
    visibility === 'hidden' &&
    audio === 'none' &&
    firstKeyLatencyMs !== undefined &&
    firstKeyLatencyMs <= typingClassifierPolicy.fastFirstKeyMs
  ) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'easy',
      errorCause: 'clean',
      confidence,
      evidenceStrength: confidence,
      retrievalValidity: 'independent',
      reasonCodes: ['unaided-fast-clean-recall'],
    }
  }

  if (
    firstKeyLatencyMs !== undefined &&
    firstKeyLatencyMs >= typingClassifierPolicy.veryLongFirstKeyMs
  ) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'hard',
      errorCause: 'clean',
      confidence,
      evidenceStrength: Math.min(confidence, 0.65),
      retrievalValidity:
        visibility === 'hidden' ? 'independent' : visibility ? 'assisted' : 'unknown',
      reasonCodes: ['slow-clean-recall'],
    }
  }

  if (visibility === 'full') {
    reasons.push('orthographic-cue-full')
  } else if (visibility === 'partial') {
    reasons.push('orthographic-cue-partial')
  }

  if (audio === 'automatic') {
    reasons.push('automatic-audio-cue')
  }

  const assisted = reasons.length > 0
  return {
    version: REVIEW_EVIDENCE_VERSION,
    memoryGrade: 'good',
    errorCause: 'clean',
    confidence,
    evidenceStrength: assisted
      ? Math.min(confidence, visibility === 'full' ? 0.3 : 0.6)
      : Math.min(confidence, 0.75),
    retrievalValidity: assisted ? 'assisted' : visibility === 'hidden' ? 'independent' : 'unknown',
    reasonCodes:
      reasons.length > 0 ? dedupe(reasons) : ['clean-recall-legacy-or-unknown-condition'],
  }
}
