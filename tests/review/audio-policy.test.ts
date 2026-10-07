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

function cleanAudioRecord(
  id: number,
  word: string,
  condition: ReturnType<typeof createBaselineExerciseCondition>,
): IWordRecord {
  return {
    id,
    word,
    timeStamp: id,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    exerciseCondition: condition,
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 700,
      attempts: [],
    },
    learningContext: {
      version: 1,
      pronunciationEnabledAtStart: true,
      pronunciationPlayed: true,
      pronunciationPlayCount: 1,
      pronunciationAutomaticPlayCount: 1,
      pronunciationRequestedPlayCount: 0,
    },
  }
}

test('audio withdrawal shadow changes only the audio dimension after stable mastery', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })
  const records = [1, 2, 3].map((id) =>
    cleanAudioRecord(id, 'test', baseline),
  )

  const shadow = chooseAudioWithdrawalShadow({
    baselineCondition: baseline,
    word: 'test',
    records,
  })

  assert.ok(shadow)
  assert.equal(shadow.condition.purpose, 'probe')
  assert.equal(shadow.condition.probeDimension, 'audio')
  assert.equal(shadow.condition.audio, 'none')
  assert.equal(shadow.condition.meaning, baseline.meaning)
  assert.equal(shadow.condition.phonetic, baseline.phonetic)
  assert.deepEqual(shadow.condition.letters, baseline.letters)
  assert.equal(
    shadow.decision.policyVersion,
    'audio-withdrawal-probe-v1',
  )
})

test('audio withdrawal requires three recent comparable clean automatic-audio records', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const records = [1, 2].map((id) =>
    cleanAudioRecord(id, 'cat', baseline),
  )

  assert.equal(
    chooseAudioWithdrawalShadow({
      baselineCondition: baseline,
      word: 'cat',
      records,
    }),
    null,
  )

  const slow = cleanAudioRecord(3, 'cat', baseline)
  if (slow.typingTelemetry) {
    slow.typingTelemetry.firstKeyLatencyMs = 2500
  }
  records.push(slow)

  assert.equal(
    chooseAudioWithdrawalShadow({
      baselineCondition: baseline,
      word: 'cat',
      records,
    }),
    null,
  )
})

test('next-exercise coordinator prioritizes spelling remediation over audio probe', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false, false, false],
  })

  const spellingFailures: IWordRecord[] = [1, 2, 3].map((id) => ({
    id,
    word: 'planet',
    timeStamp: id,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
  }))
  const recentAudioMastery = [4, 5, 6].map((id) =>
    cleanAudioRecord(id, 'planet', baseline),
  )

  const shadow = chooseNextExerciseShadow({
    baselineCondition: baseline,
    word: 'planet',
    records: [...spellingFailures, ...recentAudioMastery],
  })

  assert.ok(shadow)
  assert.equal(shadow.decision.policyVersion, 'targeted-mask-v1')
  assert.equal(shadow.condition.letters.mode, 'targeted-mask')
})

test('audio withdrawal does not run when pronunciation is already disabled', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: false,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })

  assert.equal(
    chooseAudioWithdrawalShadow({
      baselineCondition: baseline,
      word: 'cat',
      records: [],
    }),
    null,
  )
})


test('audio-off probe recall failure becomes hard audio-dependence evidence, not ordinary again', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const probe = {
    ...baseline,
    purpose: 'probe' as const,
    source: 'adaptive-policy' as const,
    audio: 'none' as const,
    probeDimension: 'audio' as const,
  }
  const classification = {
    cause: 'recall' as const,
    confidence: 0.9,
    scores: { recall: 0.8, spelling: 0.1, motor: 0.1 },
  }
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: probe,
      learningContext: {
        version: 1,
        pronunciationEnabledAtStart: false,
        pronunciationRequestedPlayCount: 0,
      },
    },
    classification,
  )

  assert.equal(evidence.memoryGrade, 'hard')
  assert.equal(evidence.weaknesses?.audioDependence, 1)
  assert.ok(evidence.reasonCodes.includes('audio-dependence-evidence'))
  assert.equal(
    reviewOutcomeForAttempt({
      classification,
      evidence,
      condition: probe,
    }),
    'hard',
  )
})

test('manual pronunciation during an audio probe marks the result assisted', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const probe = {
    ...baseline,
    purpose: 'probe' as const,
    source: 'adaptive-policy' as const,
    audio: 'none' as const,
    probeDimension: 'audio' as const,
  }
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: probe,
      learningContext: {
        version: 1,
        pronunciationEnabledAtStart: false,
        pronunciationPlayed: true,
        pronunciationRequestedPlayCount: 1,
      },
    },
    {
      cause: 'clean',
      confidence: 1,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
  )

  assert.equal(evidence.memoryGrade, 'hard')
  assert.equal(evidence.retrievalValidity, 'assisted')
  assert.equal(evidence.weaknesses?.audioDependence, 0.5)
  assert.ok(
    evidence.reasonCodes.includes(
      'audio-probe-assisted-by-requested-pronunciation',
    ),
  )
})

test('frozen audio withdrawal plan becomes active while unsupported plans still fall back', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const audioShadow = chooseAudioWithdrawalShadow({
    baselineCondition: baseline,
    word: 'cat',
    records: [1, 2, 3].map((id) =>
      cleanAudioRecord(id, 'cat', baseline),
    ),
  })
  assert.ok(audioShadow)

  const active = resolveExercisePlanForAttempt(
    baseline,
    materializeReviewExercisePlan(audioShadow),
  )
  assert.equal(active.condition.audio, 'none')
  assert.equal(active.condition.probeDimension, 'audio')
  assert.equal(active.decision.policyVersion, 'audio-withdrawal-probe-v1')

  const unsupported = resolveExercisePlanForAttempt(baseline, {
    version: 1,
    sourceShadowVersion: 1,
    condition: {
      ...baseline,
      source: 'adaptive-policy',
      meaning: 'hidden',
      probeDimension: 'meaning',
    },
    decision: {
      version: 1,
      policyVersion: 'future-meaning-probe-v1',
      reasonCodes: ['future-test'],
      conditionVersion: 1,
    },
  })
  assert.equal(unsupported.condition, baseline)
  assert.equal(
    unsupported.decision.policyVersion,
    'baseline-user-settings-v1',
  )
})

test('clean audio-off probe records positive audio independence evidence', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const probe = {
    ...baseline,
    purpose: 'probe' as const,
    source: 'adaptive-policy' as const,
    audio: 'none' as const,
    probeDimension: 'audio' as const,
  }
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: probe,
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 400,
        attempts: [],
      },
      learningContext: {
        version: 1,
        pronunciationEnabledAtStart: false,
        pronunciationRequestedPlayCount: 0,
      },
    },
    {
      cause: 'clean',
      confidence: 1,
      scores: { recall: 0, spelling: 0, motor: 0 },
    },
  )

  assert.equal(evidence.memoryGrade, 'easy')
  assert.equal(evidence.weaknesses?.audioDependence, 0)
  assert.ok(evidence.reasonCodes.includes('audio-withdrawal-clean'))
})
