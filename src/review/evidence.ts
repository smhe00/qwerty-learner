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
  weaknesses?: {
    audioDependence?: number
  }
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

function assistanceReasons(observation: ReviewEvidenceObservation): string[] {
  const reasons: string[] = []
  const context = observation.learningContext
  const visibility = answerVisibility(observation)
  const audio = audioCondition(observation)

  if (context?.revealedBeforeFirstKey) {
    reasons.push('answer-revealed-before-first-key')
  }
  if (context?.meaningRevealedBeforeFirstKey) {
    reasons.push('meaning-revealed-before-first-key')
  }
  if (visibility === 'full') {
    reasons.push('orthographic-cue-full')
  } else if (visibility === 'partial') {
    reasons.push('orthographic-cue-partial')
  }
  if (audio === 'automatic') {
    reasons.push('automatic-audio-cue')
  }
  if ((context?.pronunciationRequestedPlayCount ?? 0) > 0) {
    reasons.push('requested-audio-cue')
  }
  if (context?.reviewHint) {
    reasons.push(`review-hint-${context.reviewHint.maxLevel}`)
  }

  return reasons
}

function retrievalValidityFromCondition(
  observation: ReviewEvidenceObservation,
): RetrievalValidity {
  const assistance = assistanceReasons(observation)
  if (assistance.length > 0) return 'assisted'

  const visibility = answerVisibility(observation)
  const audio = audioCondition(observation)
  if (visibility === 'hidden' && audio === 'none') return 'independent'

  return 'unknown'
}

/**
 * Evidence V2 shadow model.
 *
 * It deliberately separates memory grade from evidence strength. The current
 * scheduler does not consume this result yet; this lets us validate semantics
 * before changing due dates.
 */
export type ReviewEvidenceObservation = Pick<
  ReviewObservation,
  'typingTelemetry' | 'learningContext' | 'exerciseCondition'
>

export function evaluateReviewEvidence(
  observation: ReviewEvidenceObservation,
  classification: TypingErrorClassification,
): ReviewEvidenceV1 {
  const confidence = clamp01(classification.confidence)
  const reasons: string[] = []

  const isAudioWithdrawalProbe =
    observation.exerciseCondition?.purpose === 'probe' &&
    observation.exerciseCondition.probeDimension === 'audio' &&
    observation.exerciseCondition.audio === 'none'

  const reviewHint = observation.learningContext?.reviewHint
  if (reviewHint?.coldProbeSurrendered) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'again',
      errorCause: 'recall',
      confidence: 1,
      evidenceStrength: 1,
      retrievalValidity: 'independent',
      reasonCodes: [
        'cold-probe-surrendered',
        `review-hint-${reviewHint.maxLevel}`,
        `review-hint-advances-${reviewHint.advanceCount}`,
      ],
    }
  }

  const requestedAudioDuringProbe =
    isAudioWithdrawalProbe &&
    (observation.learningContext?.pronunciationRequestedPlayCount ?? 0) > 0

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

  if (requestedAudioDuringProbe) {
    return {
      version: REVIEW_EVIDENCE_VERSION,
      memoryGrade: 'hard',
      errorCause: classification.cause,
      confidence,
      evidenceStrength: Math.min(confidence, 0.35),
      retrievalValidity: 'assisted',
      reasonCodes: ['audio-probe-assisted-by-requested-pronunciation'],
      weaknesses: {
        audioDependence: 0.5,
      },
    }
  }

  if (classification.cause !== 'clean') {
    if (classification.cause === 'recall') {
      if (isAudioWithdrawalProbe) {
        return {
          version: REVIEW_EVIDENCE_VERSION,
          memoryGrade: 'hard',
          errorCause: 'recall',
          confidence,
          evidenceStrength: confidence,
          retrievalValidity: 'independent',
          reasonCodes: [
            'audio-withdrawal-recall-failure',
            'audio-dependence-evidence',
          ],
          weaknesses: {
            audioDependence: 1,
          },
        }
      }
      const cueReasons = assistanceReasons(observation)
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'again',
        errorCause: 'recall',
        confidence,
        evidenceStrength: confidence,
        retrievalValidity: retrievalValidityFromCondition(observation),
        reasonCodes: dedupe(['recall-failure', ...cueReasons]),
      }
    }

    if (classification.cause === 'spelling') {
      const cueReasons = assistanceReasons(observation)
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'hard',
        errorCause: 'spelling',
        confidence,
        evidenceStrength: confidence,
        retrievalValidity: retrievalValidityFromCondition(observation),
        reasonCodes: dedupe(['spelling-weakness', ...cueReasons]),
      }
    }

    if (classification.cause === 'motor') {
      const cueReasons = assistanceReasons(observation)
      return {
        version: REVIEW_EVIDENCE_VERSION,
        memoryGrade: 'good',
        errorCause: 'motor',
        confidence,
        evidenceStrength: Math.max(0.5, confidence),
        retrievalValidity: retrievalValidityFromCondition(observation),
        reasonCodes: dedupe(['motor-error-not-memory-failure', ...cueReasons]),
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
      reasonCodes: isAudioWithdrawalProbe
        ? ['audio-withdrawal-clean', 'unaided-fast-clean-recall']
        : ['unaided-fast-clean-recall'],
      weaknesses: isAudioWithdrawalProbe
        ? { audioDependence: 0 }
        : undefined,
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
  if (isAudioWithdrawalProbe) {
    reasons.push('audio-withdrawal-clean')
  }

  const assisted = reasons.some(
    (reason) =>
      reason === 'orthographic-cue-full' ||
      reason === 'orthographic-cue-partial' ||
      reason === 'automatic-audio-cue' ||
      reason === 'requested-audio-cue',
  )
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
    weaknesses: isAudioWithdrawalProbe
      ? { audioDependence: 0 }
      : undefined,
  }
}
