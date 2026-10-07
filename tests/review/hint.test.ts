import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLearnAcquisitionExercisePlan,
  createLearnAcquisitionState,
  decideLearnAcquisitionTransition,
  deferLearnAcquisitionForSpacing,
  hasSufficientIndependentSpacing,
  resumeSpacingDeferredAcquisition,
  projectLearnAcquisitionProgress,
} from '../../src/learn/acquisition'
import {
  decideLearnScaffold,
  getLearnScaffoldPresentation,
} from '../../src/learn/scaffold'
import {
  applyLearnRecoveryWindow,
  planLearnRecoveryWindow,
} from '../../src/learn/recovery-window'
import {
  decideLearningLifecycleTransition,
  getLearningLifecycle,
  pruneLearnSessionWord,
} from '../../src/learn/lifecycle'
import {
  LEARN_NEW_WORD_BATCH_SIZE,
  canonicalizeLearningWords,
  countUnseenLearningWords,
  createLearnAcquisitionPlan,
  selectUnseenLearningWords,
} from '../../src/learn/session'
import {
  createBaselineExerciseCondition,
  isLetterVisibleForExerciseCondition,
} from '../../src/review/condition'
import {
  CANONICAL_REVIEW_PROBE_POLICY_VERSION,
  createBaselineReviewPolicyDecision,
  createCanonicalReviewProbePlan,
  createReviewPolicyShadow,
  materializeReviewExercisePlan,
} from '../../src/review/decision'
import { classifyTypingError } from '../../src/review/classifier'
import { selectReviewCandidates } from '../../src/review/due'
import { evaluateReviewEvidence } from '../../src/review/evidence'
import {
  chooseAudioWithdrawalShadow,
  chooseNextExerciseShadow,
  chooseTargetedMaskPlan,
  chooseTargetedMaskShadow,
  resolveExercisePlanForAttempt,
} from '../../src/review/exercise-policy'
import { buildReviewObservation } from '../../src/review/observation'
import {
  applyReviewHintDecision,
  createReviewHintMachineState,
  createReviewHintPlan,
  decideReviewHintInput,
  observeReviewHintWrong,
  reviewHintTerminationVariant,
} from '../../src/review/hint'
import {
  decideReviewProgress,
  decideWordInput,
  shouldPlayAutomaticPronunciation,
} from '../../src/review/machine'
import {
  hasUnreviewedLearningFailure,
  inferReviewOutcomeFromWordRecord,
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
  shouldDropLegacyTypingSeededState,
} from '../../src/review/rebuild'
import { buildOrthographyProfile } from '../../src/review/profile'
import {
  MAX_REINFORCEMENT_GAP,
  buildReviewSessionExercisePlans,
  getReviewAttemptRole,
  getWordComponentInstanceKey,
} from '../../src/review/session'
import {
  reviewOutcomeForAttempt,
  scheduleBasicReview,
  upgradeBasicSchedulerState,
} from '../../src/review/scheduler'
import {
  createReviewItemMachineState,
  resolveCompletedReviewItem,
} from '../../src/review/state-machine'
import {
  CURRENT_REVIEW_STATE_VERSION,
  createInitialReviewWordState,
} from '../../src/review/types'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import type { IWordRecord } from '../../src/utils/db/record'
import {
  getFirstValidDictionaryExample,
  maskDictionaryExample,
} from '../../src/utils/dictionaryExample'

test('Hint V2 uses ESC as the only explicit surrender and Space stays ordinary input', () => {
  const state = createReviewHintMachineState()

  const escape = decideReviewHintInput({
    state,
    inputIndex: 3,
    key: 'Escape',
  })
  assert.equal(escape.kind, 'advance-hint')
  if (escape.kind !== 'advance-hint') return
  assert.equal(escape.from, 'cold-probe')
  assert.equal(escape.to, 'hint-3')
  assert.equal(escape.level, 3)
  assert.equal(escape.hintPosition, 3)
  assert.equal(escape.coldProbeSurrendered, true)
  assert.equal(escape.failureCount, 0)
  assert.equal(escape.trigger, 'manual-escape')

  const terminal = applyReviewHintDecision(state, escape)
  assert.equal(terminal.stage, 'hint-3')
  assert.equal(terminal.advanceCount, 1)
  assert.equal(terminal.coldProbeSurrendered, true)
  assert.ok(
    reviewHintTerminationVariant(terminal) <
      reviewHintTerminationVariant(state),
  )

  assert.deepEqual(
    decideReviewHintInput({
      state,
      inputIndex: 0,
      key: ' ',
    }),
    { kind: 'type-key' },
  )
  assert.deepEqual(
    decideReviewHintInput({
      state,
      inputIndex: 3,
      key: ' ',
    }),
    { kind: 'type-key' },
  )
  assert.deepEqual(
    decideReviewHintInput({
      state: terminal,
      inputIndex: 0,
      key: 'Escape',
    }),
    { kind: 'type-key' },
  )
})

test('Hint V2 presentation is Minimal -> Strong -> Full with legacy level 2 as Strong alias', () => {
  const hint0 = createReviewHintPlan(0, 6, 3)
  assert.equal(hint0.condition.audio, 'none')
  assert.equal(hint0.condition.phonetic, 'hidden')
  assert.deepEqual(hint0.condition.letters, {
    mode: 'partial',
    visiblePositions: [3],
    maskedPositions: [0, 1, 2, 4, 5],
  })

  const hint1 = createReviewHintPlan(1, 6, 3)
  assert.equal(hint1.condition.audio, 'automatic')
  assert.equal(hint1.condition.phonetic, 'visible')
  assert.deepEqual(hint1.condition.letters, {
    mode: 'partial',
    visiblePositions: [0, 2, 3, 4],
    maskedPositions: [1, 5],
  })

  const hint2 = createReviewHintPlan(2, 6, 3)
  assert.deepEqual(
    hint2.condition.letters,
    hint1.condition.letters,
  )

  const hint3 = createReviewHintPlan(3, 6, 3)
  assert.equal(hint3.condition.audio, 'automatic')
  assert.equal(hint3.condition.phonetic, 'visible')
  assert.deepEqual(hint3.condition.letters, {
    mode: 'all-visible',
  })
})

test('Hint V2 has one global three-failure budget with no stage-local retries', () => {
  let state = createReviewHintMachineState()

  const firstBefore = reviewHintTerminationVariant(state)
  let observed = observeReviewHintWrong({
    state,
    wrongIndex: 2,
    wordLength: 6,
  })
  assert.equal(observed.decision?.kind, 'advance-hint')
  if (observed.decision?.kind !== 'advance-hint') return
  assert.equal(observed.decision.level, 0)
  assert.equal(observed.decision.to, 'hint-0')
  assert.equal(observed.decision.failureCount, 1)
  assert.equal(observed.decision.hintPosition, 2)
  assert.equal(observed.decision.trigger, 'failed-retrieval')
  state = applyReviewHintDecision(
    observed.state,
    observed.decision,
  )
  assert.equal(state.failureCount, 1)
  assert.equal(state.stage, 'hint-0')
  assert.deepEqual(state.forcedRevealPositions, [2])
  assert.ok(reviewHintTerminationVariant(state) < firstBefore)

  const secondBefore = reviewHintTerminationVariant(state)
  observed = observeReviewHintWrong({
    state,
    wrongIndex: 0,
    wordLength: 6,
  })
  assert.equal(observed.decision?.kind, 'advance-hint')
  if (observed.decision?.kind !== 'advance-hint') return
  assert.equal(observed.decision.level, 1)
  assert.equal(observed.decision.to, 'hint-1')
  assert.equal(observed.decision.failureCount, 2)
  state = applyReviewHintDecision(
    observed.state,
    observed.decision,
  )
  assert.equal(state.failureCount, 2)
  assert.equal(state.stage, 'hint-1')
  assert.deepEqual(state.forcedRevealPositions, [0, 2])
  assert.ok(reviewHintTerminationVariant(state) < secondBefore)

  const thirdBefore = reviewHintTerminationVariant(state)
  observed = observeReviewHintWrong({
    state,
    wrongIndex: 1,
    wordLength: 6,
  })
  assert.equal(observed.decision?.kind, 'advance-hint')
  if (observed.decision?.kind !== 'advance-hint') return
  assert.equal(observed.decision.level, 3)
  assert.equal(observed.decision.to, 'hint-3')
  assert.equal(observed.decision.failureCount, 3)
  state = applyReviewHintDecision(
    observed.state,
    observed.decision,
  )
  assert.equal(state.failureCount, 3)
  assert.equal(state.stage, 'hint-3')
  assert.deepEqual(state.forcedRevealPositions, [0, 1, 2])
  assert.ok(reviewHintTerminationVariant(state) < thirdBefore)

  const afterFull = observeReviewHintWrong({
    state,
    wrongIndex: 4,
    wordLength: 6,
  })
  assert.equal(afterFull.decision, null)
  assert.equal(afterFull.state.stage, 'hint-3')
  assert.equal(afterFull.state.failureCount, 3)
})

test('Strong Hint retains known wrong positions while revealing roughly half the word', () => {
  const strong = createReviewHintPlan(1, 6, 3, [1, 4])
  assert.deepEqual(strong.condition.letters, {
    mode: 'partial',
    visiblePositions: [0, 1, 2, 3, 4],
    maskedPositions: [5],
  })
})

test('cold-probe surrender remains Again even when final full-answer typing is clean', () => {
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: createReviewHintPlan(3, 6).condition,
      learningContext: {
        version: 1,
        reviewHint: {
          version: 1,
          maxLevel: 3,
          coldProbeSurrendered: true,
          advanceCount: 1,
          failureCount: 0,
        },
      },
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 500,
        attempts: [],
      },
    },
    {
      cause: 'clean',
      confidence: 0.9,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
  )

  assert.equal(evidence.memoryGrade, 'again')
  assert.equal(evidence.errorCause, 'recall')
  assert.equal(evidence.retrievalValidity, 'independent')
  assert.ok(
    evidence.reasonCodes.includes(
      'cold-probe-surrendered',
    ),
  )
})

test('frozen Cold Probe evidence survives assisted full-answer completion', () => {
  const frozen = {
    version: 1 as const,
    memoryGrade: 'hard' as const,
    errorCause: 'spelling' as const,
    confidence: 0.82,
    evidenceStrength: 0.82,
    retrievalValidity: 'independent' as const,
    reasonCodes: ['spelling-weakness'],
  }

  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: createReviewHintPlan(3, 6).condition,
      learningContext: {
        version: 1,
        coldProbeEvidence: frozen,
        reviewHint: {
          version: 1,
          maxLevel: 3,
          coldProbeSurrendered: false,
          advanceCount: 3,
          failureCount: 3,
          hintPosition: 2,
          autoHint0Triggered: true,
        },
      },
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 500,
        attempts: [],
      },
    },
    {
      cause: 'clean',
      confidence: 1,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
  )

  assert.equal(evidence.memoryGrade, 'hard')
  assert.equal(evidence.errorCause, 'spelling')
  assert.equal(evidence.retrievalValidity, 'independent')
  assert.equal(evidence.confidence, 0.82)
  assert.ok(
    evidence.reasonCodes.includes(
      'cold-probe-failure-frozen',
    ),
  )
  assert.ok(
    evidence.reasonCodes.includes(
      'review-hint-failures-3',
    ),
  )
})

