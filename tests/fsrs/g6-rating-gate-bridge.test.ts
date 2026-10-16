/**
 * G6-1 research-only bridge: execute QWERTY's REAL Rating Gate before touching
 * native FSRS short-term/relearning state.
 *
 * This is evidence for event eligibility, not a production integration.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating, createEmptyCard, fsrs } from 'ts-fsrs'
import { createCanonicalReviewProbePlan } from '../../src/review/decision'
import { decideReviewRating, type RatingDecision } from '../../src/review/state-machine'
import type { ReviewEvidenceV1 } from '../../src/review/evidence'
import type { TypingErrorClassification } from '../../src/review/classifier'
import type { ReviewOutcome } from '../../src/review/types'

const canonical = createCanonicalReviewProbePlan().condition
const first = Date.parse('2026-10-16T08:00:00.000Z')

const clean: TypingErrorClassification = {
  cause: 'clean', confidence: 1, scores: { recall: 0, spelling: 0, motor: 0 },
}
const recallFailure: TypingErrorClassification = {
  cause: 'recall', confidence: 0.95, scores: { recall: 1, spelling: 0, motor: 0 },
}
const distracted: TypingErrorClassification = {
  cause: 'uncertain', confidence: 0.4, attentionUncertain: true,
  scores: { recall: 0.34, spelling: 0.33, motor: 0.33 },
}
function evidence(overrides: Partial<ReviewEvidenceV1> = {}): ReviewEvidenceV1 {
  return {
    version: 1,
    memoryGrade: 'good',
    errorCause: 'clean',
    confidence: 1,
    evidenceStrength: 1,
    retrievalValidity: 'independent',
    reasonCodes: [],
    ...overrides,
  }
}
function rating(decision: RatingDecision): Rating | undefined {
  if (!decision.eligible) return undefined
  const grades: Record<ReviewOutcome, Rating> = {
    again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy,
  }
  return grades[decision.rating]
}

test('G6-1: canonical independent recall is eligible, but copied and assisted work is not', () => {
  const valid = decideReviewRating({
    attemptRole: 'cold', condition: canonical,
    classification: clean, evidence: evidence(),
  })
  assert.equal(valid.eligible, true)
  assert.equal(rating(valid), Rating.Good)

  const assisted = decideReviewRating({
    attemptRole: 'cold', condition: canonical, classification: clean,
    evidence: evidence({
      retrievalValidity: 'assisted',
      reasonCodes: ['clean-after-assistance', 'orthographic-cue-partial'],
    }),
  })
  assert.equal(assisted.eligible, false)
  assert.equal(rating(assisted), undefined)

  const training = decideReviewRating({
    attemptRole: 'training', condition: canonical, classification: clean, evidence: evidence(),
  })
  assert.equal(training.eligible, false)

  const diagnostic = decideReviewRating({
    attemptRole: 'cold',
    condition: { ...canonical, probeDimension: 'audio' },
    classification: clean, evidence: evidence(),
  })
  assert.equal(diagnostic.eligible, false)

  const attention = decideReviewRating({
    attemptRole: 'cold', condition: canonical, classification: distracted,
    evidence: evidence({ retrievalValidity: 'uncertain', memoryGrade: 'hard' }),
  })
  assert.equal(attention.eligible, false)
})

test('G6-1: ESC/cold-probe failure is retained as Again, while later hinted completion is not another rating', () => {
  const surrendered = decideReviewRating({
    attemptRole: 'cold', condition: canonical,
    classification: recallFailure,
    evidence: evidence({
      memoryGrade: 'again',
      errorCause: 'recall',
      reasonCodes: ['cold-probe-surrendered'],
    }),
  })
  assert.equal(surrendered.eligible, true)
  assert.equal(rating(surrendered), Rating.Again)

  const frozenFailure = decideReviewRating({
    attemptRole: 'cold', condition: canonical,
    classification: recallFailure,
    evidence: evidence({
      memoryGrade: 'again',
      errorCause: 'recall',
      reasonCodes: ['cold-probe-failure-frozen'],
    }),
  })
  assert.equal(frozenFailure.eligible, true)
  assert.equal(rating(frozenFailure), Rating.Again)

  const hintAfterward = decideReviewRating({
    attemptRole: 'reinforcement', condition: canonical,
    classification: clean,
    evidence: evidence({
      retrievalValidity: 'assisted',
      reasonCodes: ['clean-after-assistance', 'review-hint-3'],
    }),
  })
  assert.equal(hintAfterward.eligible, false)
  assert.equal(rating(hintAfterward), undefined)
})

test('G6-1: native Relearning receives only eligible Rating Gate outputs', () => {
  const scheduler = fsrs({
    request_retention: 0.84,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: [],
    relearning_steps: ['10m'],
  })
  let card = createEmptyCard(new Date(first))
  const events = [
    {
      at: first, decision: decideReviewRating({
        attemptRole: 'cold', condition: canonical,
        classification: clean, evidence: evidence(),
      }),
    },
    {
      at: first + 60_000, decision: decideReviewRating({
        attemptRole: 'training', condition: canonical,
        classification: clean, evidence: evidence(),
      }),
    },
    {
      at: first + 4 * 86_400_000, decision: decideReviewRating({
        attemptRole: 'cold', condition: canonical,
        classification: recallFailure,
        evidence: evidence({ memoryGrade: 'again', errorCause: 'recall' }),
      }),
    },
    {
      at: first + 4 * 86_400_000 + 60_000, decision: decideReviewRating({
        attemptRole: 'reinforcement', condition: canonical,
        classification: clean, evidence: evidence({
          retrievalValidity: 'assisted', reasonCodes: ['clean-after-assistance'],
        }),
      }),
    },
  ]
  let applied = 0
  for (const item of events) {
    const grade = rating(item.decision)
    if (grade === undefined) continue
    card = scheduler.next(card, new Date(item.at), grade).card
    applied += 1
  }
  assert.equal(applied, 2)
  assert.equal(card.reps, 2)
  assert.equal(card.lapses, 1)
  assert.equal(card.due.getTime(), first + 4 * 86_400_000 + 10 * 60_000)
})
