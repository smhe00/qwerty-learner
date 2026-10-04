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
import { buildLearnDailyPlan } from '../../src/learn/plan'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import { estimateLearnInteractionStrain } from '../../src/learn/strain'
import type { IWordRecord } from '../../src/utils/db/record'
import {
  getFirstValidDictionaryExample,
  maskDictionaryExample,
} from '../../src/utils/dictionaryExample'

test('captures all-visible and all-hidden baseline conditions', () => {
  assert.deepEqual(
    createBaselineExerciseCondition({
      pronunciationEnabled: true,
      meaningVisible: true,
      phoneticVisible: false,
      letterVisibility: [true, true, true],
    }),
    {
      version: 1,
      purpose: 'training',
      source: 'user-settings',
      audio: 'automatic',
      meaning: 'visible',
      phonetic: 'hidden',
      letters: { mode: 'all-visible' },
      probeDimension: 'none',
    },
  )

  assert.deepEqual(
    createBaselineExerciseCondition({
      pronunciationEnabled: false,
      meaningVisible: false,
      phoneticVisible: true,
      letterVisibility: [false, false],
    }),
    {
      version: 1,
      purpose: 'training',
      source: 'user-settings',
      audio: 'none',
      meaning: 'hidden',
      phonetic: 'visible',
      letters: { mode: 'all-hidden' },
      probeDimension: 'none',
    },
  )
})

test('records exact positions for a partial baseline mask', () => {
  const condition = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: true,
    letterVisibility: [true, false, true, false],
  })

  assert.deepEqual(condition.letters, {
    mode: 'partial',
    visiblePositions: [0, 2],
    maskedPositions: [1, 3],
  })
})

test('creates versioned baseline policy metadata', () => {
  assert.deepEqual(createBaselineReviewPolicyDecision(), {
    version: 1,
    policyVersion: 'baseline-user-settings-v1',
    reasonCodes: ['baseline-user-settings'],
    conditionVersion: 1,
  })
})

test('builds an observation from legacy records without inventing missing evidence', () => {
  const legacy: IWordRecord = {
    id: 7,
    word: 'legacy',
    timeStamp: 100,
    dict: 'cet4',
    chapter: 0,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
  }

  const observation = buildReviewObservation(legacy)

  assert.equal(observation.version, 1)
  assert.equal(observation.recordId, 7)
  assert.equal(observation.word, 'legacy')
  assert.deepEqual(observation.mistakes, { 2: ['x'] })
  assert.equal(observation.exerciseCondition, undefined)
  assert.equal(observation.reviewPolicyDecision, undefined)
  assert.equal(observation.typingTelemetry, undefined)
  assert.equal(observation.learningContext, undefined)
})

test('carries adaptive condition and policy metadata into observations', () => {
  const exerciseCondition = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [true, false, true],
  })
  const reviewPolicyDecision = createBaselineReviewPolicyDecision()

  const record: IWordRecord = {
    word: 'adapt',
    timeStamp: 200,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    exerciseCondition,
    reviewPolicyDecision,
  }

  const observation = buildReviewObservation(record)
  assert.deepEqual(observation.exerciseCondition, exerciseCondition)
  assert.deepEqual(observation.reviewPolicyDecision, reviewPolicyDecision)
})

test('evidence v2 grades unaided fast clean recall as easy', () => {
  const condition = createBaselineExerciseCondition({
    pronunciationEnabled: false,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false],
  })
  const observation = buildReviewObservation({
    word: 'fast',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 400,
      attempts: [],
    },
    exerciseCondition: condition,
  })

  const result = evaluateReviewEvidence(observation, {
    cause: 'clean',
    confidence: 1,
    scores: { recall: 0, spelling: 0, motor: 0 },
  })

  assert.equal(result.memoryGrade, 'easy')
  assert.equal(result.retrievalValidity, 'independent')
  assert.deepEqual(result.reasonCodes, ['unaided-fast-clean-recall'])
})

test('evidence v2 does not treat clean recall after answer reveal as good evidence', () => {
  const observation = buildReviewObservation({
    word: 'assisted',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    learningContext: {
      version: 1,
      answerVisibilityAtStart: 'hidden',
      answerRevealed: true,
      revealedBeforeFirstKey: true,
    },
  })

  const result = evaluateReviewEvidence(observation, {
    cause: 'clean',
    confidence: 1,
    scores: { recall: 0, spelling: 0, motor: 0 },
  })

  assert.equal(result.memoryGrade, 'hard')
  assert.equal(result.retrievalValidity, 'assisted')
  assert.ok(result.reasonCodes.includes('answer-revealed-before-first-key'))
})

test('evidence v2 downgrades very slow clean recall', () => {
  const observation = buildReviewObservation({
    word: 'slow',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 3500,
      attempts: [],
    },
    exerciseCondition: createBaselineExerciseCondition({
      pronunciationEnabled: false,
      meaningVisible: true,
      phoneticVisible: false,
      letterVisibility: [false, false, false, false],
    }),
  })

  const result = evaluateReviewEvidence(observation, {
    cause: 'clean',
    confidence: 1,
    scores: { recall: 0, spelling: 0, motor: 0 },
  })

  assert.equal(result.memoryGrade, 'hard')
  assert.ok(result.reasonCodes.includes('slow-clean-recall'))
})

const errorGradeCases = [
  ['recall', 'again', 'recall-failure'],
  ['spelling', 'hard', 'spelling-weakness'],
  ['motor', 'good', 'motor-error-not-memory-failure'],
  ['uncertain', 'hard', 'error-cause-uncertain'],
] as const

for (const [cause, expectedGrade, reasonCode] of errorGradeCases) {
  test('evidence v2 maps ' + cause + ' errors to ' + expectedGrade, () => {
    const observation = buildReviewObservation({
      word: cause,
      timeStamp: 1,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 0: ['x'] },
    })

    const result = evaluateReviewEvidence(observation, {
      cause,
      confidence: 0.8,
      scores: { recall: 0.4, spelling: 0.3, motor: 0.3 },
    })

    assert.equal(result.memoryGrade, expectedGrade)
    assert.ok(result.reasonCodes.includes(reasonCode))
  })
}

test('evidence v2 treats attention uncertainty as low-strength hard evidence', () => {
  const observation = buildReviewObservation({
    word: 'paused',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
  })

  const result = evaluateReviewEvidence(observation, {
    cause: 'uncertain',
    confidence: 0.45,
    attentionUncertain: true,
    scores: { recall: 0.34, spelling: 0.33, motor: 0.33 },
  })

  assert.equal(result.memoryGrade, 'hard')
  assert.equal(result.retrievalValidity, 'uncertain')
  assert.ok(result.evidenceStrength <= 0.35)
})


test('orthography profile requires independent records instead of repeated events in one attempt', () => {
  const oneBadRecord: IWordRecord = {
    word: 'planet',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 3,
    mistakes: { 2: ['x', 'x', 'x'] },
  }

  const profile = buildOrthographyProfile('planet', [oneBadRecord])
  assert.equal(profile.dominantWrongIndex, 2)
  assert.equal(profile.dominantWrongRecordCount, 1)
  assert.equal(profile.positions[0].errorEventCount, 3)

  const plan = chooseTargetedMaskPlan({
    baselineCondition: createBaselineExerciseCondition({
      pronunciationEnabled: true,
      meaningVisible: true,
      phoneticVisible: false,
      letterVisibility: [false, false, false, false, false, false],
    }),
    orthography: profile,
    wordLength: 6,
  })

  assert.equal(plan, null)
})

test('orthography profile finds a stable weak position across records', () => {
  const records: IWordRecord[] = [1, 2, 3, 4].map((timeStamp, index) => ({
    word: 'planet',
    timeStamp,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: index < 3 ? { 2: ['x'] } : { 4: ['z'] },
  }))

  const profile = buildOrthographyProfile('planet', records)
  assert.equal(profile.failedRecordCount, 4)
  assert.equal(profile.dominantWrongIndex, 2)
  assert.equal(profile.dominantWrongRecordCount, 3)
  assert.equal(profile.dominantWrongRecordRatio, 0.75)
  assert.deepEqual(profile.confusions[0], {
    index: 2,
    expected: 'a',
    typed: 'x',
    count: 3,
  })
})

test('targeted mask policy hides only the stable weak position and preserves other cues', () => {
  const records: IWordRecord[] = [1, 2, 3].map((timeStamp) => ({
    word: 'planet',
    timeStamp,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
  }))
  const orthography = buildOrthographyProfile('planet', records)
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false, false, false],
  })

  const plan = chooseTargetedMaskPlan({
    baselineCondition: baseline,
    orthography,
    wordLength: 6,
  })

  assert.ok(plan)
  assert.equal(plan.condition.audio, baseline.audio)
  assert.equal(plan.condition.meaning, baseline.meaning)
  assert.equal(plan.condition.source, 'adaptive-policy')
  assert.deepEqual(plan.condition.letters, {
    mode: 'targeted-mask',
    visiblePositions: [0, 1, 3, 4, 5],
    maskedPositions: [2],
  })
  assert.equal(plan.decision.policyVersion, 'targeted-mask-v1')
  assert.ok(plan.decision.reasonCodes.includes('dominant-spelling-position'))
})

test('orthography profile prefers telemetry and does not double-count legacy mistakes', () => {
  const record: IWordRecord = {
    word: 'planet',
    timeStamp: 1,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 2,
    mistakes: { 1: ['legacy'], 2: ['legacy'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [
        {
          startLatencyMs: 500,
          durationMs: 100,
          correctPrefixLength: 2,
          result: 'wrong',
          wrongIndex: 2,
          wrongKey: 'x',
        },
        {
          startLatencyMs: 200,
          durationMs: 80,
          correctPrefixLength: 2,
          result: 'wrong',
          wrongIndex: 2,
          wrongKey: 'x',
        },
      ],
    },
  }

  const profile = buildOrthographyProfile('planet', [record])
  assert.equal(profile.totalWrongEvents, 2)
  assert.equal(profile.positions.length, 1)
  assert.equal(profile.positions[0].index, 2)
  assert.equal(profile.positions[0].errorRecordCount, 1)
})


test('creates an explicit next-exercise shadow record without changing the current condition', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })
  const decision = createBaselineReviewPolicyDecision()
  const shadow = createReviewPolicyShadow(baseline, decision)

  assert.deepEqual(shadow, {
    version: 1,
    mode: 'shadow',
    appliesTo: 'next-exercise',
    condition: baseline,
    decision,
  })
})

test('targeted mask shadow can trigger on the current attempt becoming the third independent failure', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false, false, false],
  })

  const records: IWordRecord[] = [1, 2, 3].map((timeStamp) => ({
    word: 'planet',
    timeStamp,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
  }))

  const beforeCurrent = chooseTargetedMaskShadow({
    baselineCondition: baseline,
    word: 'planet',
    records: records.slice(0, 2),
  })
  assert.equal(beforeCurrent, null)

  const afterCurrent = chooseTargetedMaskShadow({
    baselineCondition: baseline,
    word: 'planet',
    records,
  })
  assert.ok(afterCurrent)
  assert.equal(afterCurrent.mode, 'shadow')
  assert.equal(afterCurrent.appliesTo, 'next-exercise')
  assert.equal(afterCurrent.decision.policyVersion, 'targeted-mask-v1')
  assert.deepEqual(afterCurrent.condition.letters.maskedPositions, [2])
})


test('materializes a frozen exercise plan from a shadow proposal', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [true, false, true],
  })
  const shadow = createReviewPolicyShadow(
    baseline,
    createBaselineReviewPolicyDecision(),
  )

  assert.deepEqual(materializeReviewExercisePlan(shadow), {
    version: 1,
    condition: baseline,
    decision: shadow.decision,
    sourceShadowVersion: 1,
  })
})

test('review session starts every word with the canonical cold probe regardless of prior shadows', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: false,
    phoneticVisible: true,
    letterVisibility: [true, true, true, true],
  })
  const targetedShadow = createReviewPolicyShadow(
    {
      ...baseline,
      source: 'adaptive-policy',
      purpose: 'training',
      letters: {
        mode: 'targeted-mask',
        visiblePositions: [0, 1, 3],
        maskedPositions: [2],
      },
    },
    {
      version: 1,
      policyVersion: 'targeted-mask-v1',
      reasonCodes: ['dominant-spelling-position'],
      conditionVersion: 1,
    },
  )

  const plans = buildReviewSessionExercisePlans(
    [
      { name: 'test', trans: [], usphone: '', ukphone: '' },
      { name: 'legacy', trans: [], usphone: '', ukphone: '' },
    ],
    [
      {
        id: 1,
        word: 'test',
        timeStamp: 1,
        dict: 'cet4',
        chapter: -1,
        timing: [],
        wrongCount: 1,
        mistakes: { 2: ['x'] },
        reviewPolicyShadow: targetedShadow,
      },
    ],
  )

  assert.deepEqual(plans.test, createCanonicalReviewProbePlan())
  assert.deepEqual(plans.legacy, createCanonicalReviewProbePlan())
  assert.equal(
    plans.test.decision.policyVersion,
    CANONICAL_REVIEW_PROBE_POLICY_VERSION,
  )
  assert.deepEqual(plans.test.condition, {
    version: 1,
    purpose: 'probe',
    source: 'adaptive-policy',
    audio: 'none',
    meaning: 'visible',
    phonetic: 'hidden',
    letters: { mode: 'all-hidden' },
    probeDimension: 'none',
  })
})


test('a clean targeted-mask attempt withdraws the scaffold for the next exercise', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false, false, false],
  })
  const targeted = {
    ...baseline,
    source: 'adaptive-policy' as const,
    letters: {
      mode: 'targeted-mask' as const,
      visiblePositions: [0, 1, 3, 4, 5],
      maskedPositions: [2],
    },
  }

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'planet',
      timeStamp: 1,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
    },
    {
      id: 2,
      word: 'planet',
      timeStamp: 2,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
    },
    {
      id: 3,
      word: 'planet',
      timeStamp: 3,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
    },
    {
      id: 4,
      word: 'planet',
      timeStamp: 4,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      exerciseCondition: targeted,
    },
  ]

  assert.equal(
    chooseTargetedMaskShadow({
      baselineCondition: baseline,
      word: 'planet',
      records,
    }),
    null,
  )
})

test('a failed targeted-mask attempt keeps the targeted scaffold eligible', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false, false, false],
  })
  const targeted = {
    ...baseline,
    source: 'adaptive-policy' as const,
    letters: {
      mode: 'targeted-mask' as const,
      visiblePositions: [0, 1, 3, 4, 5],
      maskedPositions: [2],
    },
  }

  const records: IWordRecord[] = [1, 2, 3].map((id) => ({
    id,
    word: 'planet',
    timeStamp: id,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
  }))
  records.push({
    id: 4,
    word: 'planet',
    timeStamp: 4,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
    exerciseCondition: targeted,
  })

  const shadow = chooseTargetedMaskShadow({
    baselineCondition: baseline,
    word: 'planet',
    records,
  })
  assert.ok(shadow)
  assert.deepEqual(shadow.condition.letters.maskedPositions, [2])
})

test('historical shadow presence or absence cannot change the next session cold-probe condition', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })
  const shadow = createReviewPolicyShadow(
    {
      ...baseline,
      source: 'adaptive-policy',
      letters: {
        mode: 'targeted-mask',
        visiblePositions: [0, 1, 3],
        maskedPositions: [2],
      },
    },
    {
      version: 1,
      policyVersion: 'targeted-mask-v1',
      reasonCodes: ['dominant-spelling-position'],
      conditionVersion: 1,
    },
  )

  const plans = buildReviewSessionExercisePlans(
    [{ name: 'test', trans: [], usphone: '', ukphone: '' }],
    [
      {
        id: 1,
        word: 'test',
        timeStamp: 1,
        dict: 'cet4',
        chapter: -1,
        timing: [],
        wrongCount: 1,
        mistakes: { 2: ['x'] },
        reviewPolicyShadow: shadow,
      },
      {
        id: 2,
        word: 'test',
        timeStamp: 2,
        dict: 'cet4',
        chapter: -1,
        timing: [],
        wrongCount: 0,
        mistakes: {},
      },
    ],
  )

  assert.deepEqual(plans.test, createCanonicalReviewProbePlan())
})


test('targeted-mask condition exposes every letter except the weak position', () => {
  const condition = {
    ...createBaselineExerciseCondition({
      pronunciationEnabled: true,
      meaningVisible: true,
      phoneticVisible: false,
      letterVisibility: [false, false, false, false, false],
    }),
    source: 'adaptive-policy' as const,
    letters: {
      mode: 'targeted-mask' as const,
      visiblePositions: [0, 1, 3, 4],
      maskedPositions: [2],
    },
  }

  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) =>
      isLetterVisibleForExerciseCondition(condition, index, false),
    ),
    [true, true, false, true, true],
  )
})

test('attempt resolver activates every Learn acquisition phase without changing Typing baseline', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: false,
    meaningVisible: false,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })

  for (const phase of ['exposure', 'supported', 'independent'] as const) {
    const frozen = createLearnAcquisitionExercisePlan(phase)
    const active = resolveExercisePlanForAttempt(baseline, frozen)
    assert.equal(active.condition, frozen.condition)
    assert.equal(active.decision.policyVersion, frozen.decision.policyVersion)
  }

  const ordinary = resolveExercisePlanForAttempt(baseline)
  assert.equal(ordinary.condition, baseline)
  assert.equal(
    ordinary.decision.policyVersion,
    'baseline-user-settings-v1',
  )
})

test('attempt resolver activates only the supported frozen targeted-mask plan', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })
  const targetedCondition = {
    ...baseline,
    source: 'adaptive-policy' as const,
    letters: {
      mode: 'targeted-mask' as const,
      visiblePositions: [0, 1, 3],
      maskedPositions: [2],
    },
  }
  const shadow = createReviewPolicyShadow(
    targetedCondition,
    {
      version: 1,
      policyVersion: 'targeted-mask-v1',
      reasonCodes: ['dominant-spelling-position'],
      conditionVersion: 1,
    },
  )
  const frozen = materializeReviewExercisePlan(shadow)

  const active = resolveExercisePlanForAttempt(baseline, frozen)
  assert.equal(active.condition.source, 'adaptive-policy')
  assert.equal(active.decision.policyVersion, 'targeted-mask-v1')

  const fallback = resolveExercisePlanForAttempt(baseline)
  assert.equal(fallback.condition, baseline)
  assert.equal(fallback.decision.policyVersion, 'baseline-user-settings-v1')
})


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


test('Typing failure remains evidence-only and cannot seed Learn state', () => {
  const dueNow = 10_000
  const learningFailure: IWordRecord = {
    id: 1,
    word: 'seed',
    timeStamp: 9_000,
    dict: 'cet4',
    chapter: 3,
    timing: [],
    wrongCount: 1,
    mistakes: { 1: ['x'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 700,
      attempts: [
        {
          startLatencyMs: 700,
          durationMs: 100,
          correctPrefixLength: 1,
          result: 'wrong',
          wrongIndex: 1,
          wrongKey: 'x',
        },
      ],
    },
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(learningFailure, []),
    undefined,
  )

  const state = rebuildBasicStateFromWordRecords(
    'cet4',
    'seed',
    [learningFailure],
    { legacyDueAt: dueNow },
  )

  assert.equal(state, undefined)
})

test('ordinary learning clean telemetry does not create or advance review state', () => {
  const cleanLearning: IWordRecord = {
    id: 1,
    word: 'clean',
    timeStamp: 1_000,
    dict: 'cet4',
    chapter: 2,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 350,
      attempts: [],
    },
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(cleanLearning, []),
    undefined,
  )
  assert.equal(
    rebuildBasicStateFromWordRecords(
      'cet4',
      'clean',
      [cleanLearning],
      { legacyDueAt: 2_000 },
    ),
    undefined,
  )
})

test('only chapter -1 records advance the long-term scheduler', () => {
  const learningFailure: IWordRecord = {
    id: 1,
    word: 'reviewed',
    timeStamp: 1_000,
    dict: 'cet4',
    chapter: 4,
    timing: [],
    wrongCount: 1,
    mistakes: { 2: ['x'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 900,
      attempts: [],
    },
  }
  const reviewAttempt: IWordRecord = {
    id: 2,
    word: 'reviewed',
    timeStamp: 2_000,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 600,
      attempts: [],
    },
  }

  const state = rebuildBasicStateFromWordRecords(
    'cet4',
    'reviewed',
    [learningFailure, reviewAttempt],
    { legacyDueAt: 3_000 },
  )

  assert.ok(state)
  assert.equal(state.reviewCount, 1)
  assert.equal(state.lastReviewedAt, 2_000)
  assert.equal(state.nextReviewAt, 2_000 + 24 * 60 * 60)
  assert.deepEqual(state.schedulerState, {
    kind: 'basic-v2',
    stage: 0,
    intervalDays: 1,
  })
})

test('basic-v1 compatibility upgrade preserves due date, counters, and lifecycle exactly', () => {
  const legacy = {
    ...createInitialReviewWordState('cet4', 'legacy-v1', 100),
    updatedAt: 150,
    lastReviewedAt: 120,
    nextReviewAt: 999_999,
    reviewCount: 7,
    lapseCount: 2,
    cleanStreak: 3,
    lastOutcome: 'good' as const,
    lifecycle: 'excluded' as const,
    exclusion: {
      reason: 'manual' as const,
      excludedAt: 140,
    },
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 4,
      intervalDays: 30,
    },
  }

  const upgraded = upgradeBasicSchedulerState(legacy)

  assert.equal(upgraded.stateVersion, CURRENT_REVIEW_STATE_VERSION)
  assert.equal(upgraded.nextReviewAt, legacy.nextReviewAt)
  assert.equal(upgraded.updatedAt, legacy.updatedAt)
  assert.equal(upgraded.lastReviewedAt, legacy.lastReviewedAt)
  assert.equal(upgraded.reviewCount, legacy.reviewCount)
  assert.equal(upgraded.lapseCount, legacy.lapseCount)
  assert.equal(upgraded.cleanStreak, legacy.cleanStreak)
  assert.equal(upgraded.lifecycle, 'excluded')
  assert.deepEqual(upgraded.exclusion, legacy.exclusion)
  assert.deepEqual(upgraded.schedulerState, {
    kind: 'basic-v2',
    stage: 4,
    intervalDays: 30,
  })
})

test('basic-v2 extends mature Good reviews through 60, 120, and 180 day stages', () => {
  const day = 24 * 60 * 60
  let now = 1_000
  let state = createInitialReviewWordState('cet4', 'mature', now)

  const expectedIntervals = [1, 3, 7, 14, 30, 60, 120, 180, 180]
  for (const expectedDays of expectedIntervals) {
    state = scheduleBasicReview({
      state,
      outcome: 'good',
      now,
    })
    assert.equal(state.schedulerState.kind, 'basic-v2')
    if (state.schedulerState.kind !== 'basic-v2') return
    assert.equal(state.schedulerState.intervalDays, expectedDays)
    assert.equal(state.nextReviewAt, now + expectedDays * day)
    now = state.nextReviewAt
  }
})

test('a due legacy basic-v1 card upgrades only when rated and can advance into the v2 tail', () => {
  const day = 24 * 60 * 60
  const now = 10_000
  const legacy = {
    ...createInitialReviewWordState('cet4', 'legacy-tail', 1),
    lastReviewedAt: now - 30 * day,
    nextReviewAt: now,
    reviewCount: 5,
    cleanStreak: 5,
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 4,
      intervalDays: 30,
    },
  }

  const next = scheduleBasicReview({
    state: legacy,
    outcome: 'good',
    now,
  })

  assert.equal(next.schedulerState.kind, 'basic-v2')
  if (next.schedulerState.kind !== 'basic-v2') return
  assert.equal(next.schedulerState.stage, 5)
  assert.equal(next.schedulerState.intervalDays, 60)
  assert.equal(next.nextReviewAt, now + 60 * day)
  assert.equal(next.reviewCount, 6)
})

test('basic-v2 rollout keeps review stateVersion at 4 so legacy rows are not rebuilt', () => {
  assert.equal(CURRENT_REVIEW_STATE_VERSION, 4)
  assert.notEqual(3, CURRENT_REVIEW_STATE_VERSION)
})


test('review queue keeps WordComponent mounted across words and remounts only on explicit reload', () => {
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: false,
      reviewIndex: 0,
      reloadKey: 7,
    }),
    7,
  )
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 0,
      reloadKey: 7,
    }),
    7,
  )
  assert.equal(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 7,
    }),
    7,
  )
  assert.notEqual(
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 7,
    }),
    getWordComponentInstanceKey({
      isReviewMode: true,
      reviewIndex: 5,
      reloadKey: 8,
    }),
  )
})


test('input gate rejects every key after the target length', () => {
  assert.deepEqual(
    decideWordInput({
      inputLength: 6,
      targetLength: 6,
      hasWrong: false,
      isFinished: false,
    }),
    { accept: false, reason: 'target-complete' },
  )
  assert.deepEqual(
    decideWordInput({
      inputLength: 5,
      targetLength: 6,
      hasWrong: false,
      isFinished: false,
    }),
    { accept: true, index: 5, isFinal: true },
  )
})

test('automatic pronunciation is emitted at most once per attempt', () => {
  assert.equal(
    shouldPlayAutomaticPronunciation({
      isTyping: true,
      inputLength: 0,
      automaticAudioEnabled: true,
      alreadyPlayedForAttempt: false,
    }),
    true,
  )
  assert.equal(
    shouldPlayAutomaticPronunciation({
      isTyping: true,
      inputLength: 0,
      automaticAudioEnabled: true,
      alreadyPlayedForAttempt: true,
    }),
    false,
  )
})

test('assisted spelling and motor errors remain assisted evidence', () => {
  const assisted = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [true, true, true],
  })

  for (const cause of ['spelling', 'motor'] as const) {
    const evidence = evaluateReviewEvidence(
      { exerciseCondition: assisted },
      {
        cause,
        confidence: 0.8,
        scores: { recall: 0.1, spelling: 0.7, motor: 0.2 },
      },
    )
    assert.equal(evidence.retrievalValidity, 'assisted')
    assert.ok(evidence.reasonCodes.includes('orthographic-cue-full'))
    assert.ok(evidence.reasonCodes.includes('automatic-audio-cue'))
  }
})

test('out-of-range typo positions are excluded from orthography evidence', () => {
  const record: IWordRecord = {
    word: 'cancel',
    timeStamp: 1,
    dict: 'cet4',
    chapter: 1,
    timing: [],
    wrongCount: 1,
    mistakes: { 6: ['s'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 500,
      attempts: [
        {
          startLatencyMs: 500,
          durationMs: 50,
          correctPrefixLength: 6,
          result: 'wrong',
          wrongIndex: 6,
          wrongKey: 's',
        },
      ],
    },
  }

  const profile = buildOrthographyProfile('cancel', [record])
  assert.equal(profile.totalWrongEvents, 0)
  assert.equal(profile.dominantWrongIndex, undefined)

  const classification = classifyTypingError({
    word: 'cancel',
    wrongCount: record.wrongCount,
    telemetry: record.typingTelemetry,
  })
  assert.equal(classification.cause, 'clean')
})


test('Typing failure after Review does not reactivate Learn scheduler state', () => {
  const reviewed = createInitialReviewWordState('cet4', 'again', 100)
  reviewed.lastReviewedAt = 200
  reviewed.nextReviewAt = 200 + 24 * 60 * 60
  reviewed.reviewCount = 1
  reviewed.cleanStreak = 1
  reviewed.lastOutcome = 'good'
  reviewed.schedulerState = {
    kind: 'basic-v1',
    stage: 0,
    intervalDays: 1,
  }

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'again',
      timeStamp: 200,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
    },
    {
      id: 2,
      word: 'again',
      timeStamp: 300,
      dict: 'cet4',
      chapter: 5,
      timing: [],
      wrongCount: 2,
      mistakes: { 1: ['x'] },
    },
  ]

  assert.equal(hasUnreviewedLearningFailure(records), false)

  const reactivated = reactivateReviewStateFromLearningEvidence(
    reviewed,
    records,
    400,
  )

  assert.equal(reactivated, reviewed)
  assert.equal(reactivated.nextReviewAt, reviewed.nextReviewAt)
  assert.equal(reactivated.reviewCount, 1)
  assert.equal(reactivated.cleanStreak, 1)
  assert.equal(reactivated.lastReviewedAt, 200)
  assert.deepEqual(reactivated.schedulerState, reviewed.schedulerState)
})

test('learning failure before latest Review does not reactivate a future state', () => {
  const state = createInitialReviewWordState('cet4', 'covered', 100)
  state.lastReviewedAt = 300
  state.nextReviewAt = 10_000
  state.reviewCount = 1

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'covered',
      timeStamp: 200,
      dict: 'cet4',
      chapter: 5,
      timing: [],
      wrongCount: 1,
      mistakes: { 1: ['x'] },
    },
    {
      id: 2,
      word: 'covered',
      timeStamp: 300,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
    },
  ]

  assert.equal(hasUnreviewedLearningFailure(records), false)
  assert.equal(
    reactivateReviewStateFromLearningEvidence(state, records, 400),
    state,
  )
})

test('force Review selects all ACTIVE candidates while due mode selects only due ACTIVE candidates', () => {
  const now = 1_000
  const candidates = [
    { word: 'due' },
    { word: 'future' },
    { word: 'missing' },
  ]
  const dueState = createInitialReviewWordState('cet4', 'due', 1)
  dueState.nextReviewAt = 900
  const futureState = createInitialReviewWordState('cet4', 'future', 1)
  futureState.nextReviewAt = 2_000

  assert.deepEqual(
    selectReviewCandidates(
      candidates,
      [dueState, futureState],
      now,
      'due',
    ).map((candidate) => candidate.word),
    ['due'],
  )
  assert.deepEqual(
    selectReviewCandidates(
      candidates,
      [dueState, futureState],
      now,
      'force',
    ).map((candidate) => candidate.word),
    ['due', 'future'],
  )
})


test('Review attempt role is cold once, reinforcement thereafter, and acquisition is non-rateable', () => {
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'review',
      reinforcementUsed: 0,
    }),
    'cold',
  )
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'review',
      reinforcementUsed: 1,
    }),
    'reinforcement',
  )
  assert.equal(
    getReviewAttemptRole({
      sessionKind: 'acquisition',
      reinforcementUsed: 0,
    }),
    undefined,
  )
})

test('completed Review item retries retryable null exactly once then defers', () => {
  let state = createReviewItemMachineState()
  const attention = {
    eligible: false as const,
    rating: null,
    reason: 'attention-uncertain' as const,
    reasonCodes: ['attention-uncertain'],
  }

  const first = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: attention,
    requestReinforcement: false,
  })
  assert.equal(first.kind, 'retry-canonical')
  state = first.state
  assert.equal(state.phase, 'invalid-retry')
  assert.equal(state.invalidRetryRemaining, 0)

  const second = resolveCompletedReviewItem({
    state,
    attemptRole: 'cold',
    decision: attention,
    requestReinforcement: false,
  })
  assert.equal(second.kind, 'advance')
  assert.equal(second.state.phase, 'deferred')
})

test('completed rated failure consumes training and requests one bounded reinforcement', () => {
  const resolution = resolveCompletedReviewItem({
    state: createReviewItemMachineState(),
    attemptRole: 'cold',
    decision: {
      eligible: true,
      rating: 'again',
      confidence: 1,
      reasonCodes: ['fixture'],
    },
    requestReinforcement: true,
  })

  assert.equal(resolution.kind, 'advance')
  if (resolution.kind !== 'advance') return
  assert.equal(resolution.insertReinforcement, true)
  assert.equal(resolution.state.phase, 'reinforcement')
  assert.equal(resolution.state.ratingEmitted, true)
  assert.equal(resolution.state.reinforcementRemaining, 0)

  const terminal = resolveCompletedReviewItem({
    state: resolution.state,
    attemptRole: 'reinforcement',
    decision: {
      eligible: false,
      rating: null,
      reason: 'non-cold-attempt',
      reasonCodes: ['non-cold-attempt'],
    },
    requestReinforcement: false,
  })
  assert.equal(terminal.kind, 'advance')
  assert.equal(terminal.state.phase, 'done')
  if (terminal.kind === 'advance') {
    assert.equal(terminal.insertReinforcement, false)
  }
})

test('review progression can insert explicit reinforcement even after zero wrong keys', () => {
  const queue = [{ name: 'forgotten' }, { name: 'next' }]
  const decision = decideReviewProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 0,
    currentReinforcementGap: MAX_REINFORCEMENT_GAP,
    attemptReinforcementGap: MAX_REINFORCEMENT_GAP,
    reinforcementRemaining: 1,
    requestReinforcement: true,
  })

  assert.equal(decision.kind, 'advance')
  if (decision.kind !== 'advance') return
  assert.equal(decision.insertWord?.word.name, 'forgotten')
})

test('review progression refuses a second reinforcement when the per-session budget is exhausted', () => {
  const word = { name: 'persistent' }
  const decision = decideReviewProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 3,
    currentReinforcementGap: 3,
    attemptReinforcementGap: 3,
    reinforcementRemaining: 0,
  })

  assert.deepEqual(decision, { kind: 'finish' })
})

test('review progression consumes the only reinforcement opportunity when budget remains', () => {
  const word = { name: 'persistent' }
  const decision = decideReviewProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    currentExerciseCount: 0,
    loopWordTimes: 1,
    priorAccumulatedWrongCount: 0,
    attemptWrongCount: 3,
    currentReinforcementGap: 3,
    attemptReinforcementGap: 3,
    reinforcementRemaining: 1,
  })

  assert.equal(decision.kind, 'advance')
  if (decision.kind === 'advance') {
    assert.equal(decision.nextIndex, 1)
    assert.equal(decision.insertWord?.word.name, 'persistent')
  }
})


test('canonical Review probe overrides ordinary user presentation settings', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: false,
    phoneticVisible: true,
    letterVisibility: [true, true, true],
  })
  const canonical = createCanonicalReviewProbePlan()
  const active = resolveExercisePlanForAttempt(baseline, canonical)

  assert.equal(active.decision.policyVersion, CANONICAL_REVIEW_PROBE_POLICY_VERSION)
  assert.deepEqual(active.condition, canonical.condition)
  assert.equal(active.condition.purpose, 'probe')
  assert.equal(active.condition.probeDimension, 'none')
  assert.equal(active.condition.audio, 'none')
  assert.equal(active.condition.meaning, 'visible')
  assert.equal(active.condition.phonetic, 'hidden')
  assert.equal(active.condition.letters.mode, 'all-hidden')
})

test('manually requested pronunciation marks an otherwise canonical retrieval as assisted', () => {
  const condition = createCanonicalReviewProbePlan().condition
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: condition,
      learningContext: {
        version: 1,
        answerVisibilityAtStart: 'hidden',
        meaningVisibleAtStart: true,
        phoneticVisibleAtStart: false,
        pronunciationEnabledAtStart: false,
        pronunciationPlayed: true,
        pronunciationPlayedBeforeFirstKey: true,
        pronunciationPlayCount: 1,
        pronunciationAutomaticPlayCount: 0,
        pronunciationRequestedPlayCount: 1,
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

  assert.equal(evidence.retrievalValidity, 'assisted')
  assert.ok(evidence.reasonCodes.includes('requested-audio-cue'))
})


test('Review hint ladder escalates on Escape at any input position and Hint 3 cannot be skipped', () => {
  let state = createReviewHintMachineState()
  const expected = [
    { stage: 'hint-0', level: 0 },
    { stage: 'hint-1', level: 1 },
    { stage: 'hint-2', level: 2 },
    { stage: 'hint-3', level: 3 },
  ] as const

  for (const item of expected) {
    const before = reviewHintTerminationVariant(state)
    const decision = decideReviewHintInput({
      state,
      inputIndex: item.level + 1,
      key: 'Escape',
    })
    assert.equal(decision.kind, 'advance-hint')
    if (decision.kind === 'advance-hint') {
      assert.equal(decision.to, item.stage)
      assert.equal(decision.level, item.level)
      state = applyReviewHintDecision(state, decision)
    }
    assert.ok(reviewHintTerminationVariant(state) < before)
  }

  assert.equal(state.stage, 'hint-3')
  assert.equal(state.coldProbeSurrendered, true)
  assert.equal(state.advanceCount, 4)

  assert.deepEqual(
    decideReviewHintInput({ state, inputIndex: 0, key: 'Escape' }),
    { kind: 'type-key' },
  )
  assert.deepEqual(
    decideReviewHintInput({ state, inputIndex: 3, key: 'Escape' }),
    { kind: 'type-key' },
  )
  assert.deepEqual(
    decideReviewHintInput({
      state: createReviewHintMachineState(),
      inputIndex: 0,
      key: ' ',
    }),
    { kind: 'type-key' },
  )
})

test('cold Escape surrender uses the next untyped position and Space stays a typing key', () => {
  const state = createReviewHintMachineState()

  const escapeDecision = decideReviewHintInput({
    state,
    inputIndex: 3,
    key: 'Escape',
  })
  assert.equal(escapeDecision.kind, 'advance-hint')
  if (escapeDecision.kind === 'advance-hint') {
    assert.equal(escapeDecision.level, 0)
    assert.equal(escapeDecision.hintPosition, 3)
    assert.equal(escapeDecision.coldProbeSurrendered, true)
    assert.equal(escapeDecision.trigger, 'manual-escape')
  }

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
})

test('Review hint plans implement position cue, audio+phonetic, partial spelling, then mandatory full copy', () => {
  const hint0 = createReviewHintPlan(0, 6)
  assert.equal(hint0.condition.audio, 'none')
  assert.equal(hint0.condition.phonetic, 'hidden')
  assert.deepEqual(hint0.condition.letters, {
    mode: 'partial',
    visiblePositions: [0],
    maskedPositions: [1, 2, 3, 4, 5],
  })

  const hint1 = createReviewHintPlan(1, 6)
  assert.equal(hint1.condition.audio, 'automatic')
  assert.equal(hint1.condition.phonetic, 'visible')
  assert.deepEqual(hint1.condition.letters.visiblePositions, [0])

  const hint2 = createReviewHintPlan(2, 6)
  assert.equal(hint2.condition.audio, 'automatic')
  assert.equal(hint2.condition.phonetic, 'visible')
  assert.deepEqual(hint2.condition.letters, {
    mode: 'partial',
    visiblePositions: [0, 2, 4],
    maskedPositions: [1, 3, 5],
  })

  const hint3 = createReviewHintPlan(3, 6)
  assert.equal(hint3.condition.audio, 'automatic')
  assert.equal(hint3.condition.phonetic, 'visible')
  assert.deepEqual(hint3.condition.letters, { mode: 'all-visible' })
})

test('Hint 0 targets the last spelling first-wrong position instead of always the first letter', () => {
  let state = createReviewHintMachineState()

  const observation = observeReviewHintWrong({
    state,
    wrongIndex: 3,
    wordLength: 6,
  })
  state = observation.state
  assert.equal(observation.decision, null)
  assert.equal(state.lastWrongIndex, 3)

  const decision = decideReviewHintInput({
    state,
    inputIndex: 0,
    key: 'Escape',
  })
  assert.equal(decision.kind, 'advance-hint')
  if (decision.kind !== 'advance-hint') return

  assert.equal(decision.level, 0)
  assert.equal(decision.hintPosition, 3)
  assert.equal(decision.trigger, 'manual-escape')

  state = applyReviewHintDecision(state, decision)
  assert.equal(state.hintPosition, 3)

  const hint0 = createReviewHintPlan(0, 6, state.hintPosition)
  assert.deepEqual(hint0.condition.letters, {
    mode: 'partial',
    visiblePositions: [3],
    maskedPositions: [0, 1, 2, 4, 5],
  })

  const hint1 = createReviewHintPlan(1, 6, state.hintPosition)
  assert.deepEqual(hint1.condition.letters.visiblePositions, [3])

  const hint2 = createReviewHintPlan(2, 6, state.hintPosition)
  assert.deepEqual(hint2.condition.letters.visiblePositions, [0, 2, 3, 4])
})

test('cold repeated position enters Hint 0 and each hinted level auto-advances after two failures', () => {
  let state = createReviewHintMachineState()

  let observed = observeReviewHintWrong({
    state,
    wrongIndex: 2,
    wordLength: 6,
  })
  state = observed.state
  assert.equal(observed.decision, null)
  assert.equal(state.wrongPositionCounts[2], 1)

  const beforeColdAdvance = reviewHintTerminationVariant(state)
  observed = observeReviewHintWrong({
    state,
    wrongIndex: 2,
    wordLength: 6,
  })
  state = observed.state
  assert.equal(observed.decision?.kind, 'advance-hint')
  if (observed.decision?.kind !== 'advance-hint') return
  assert.equal(observed.decision.level, 0)
  assert.equal(observed.decision.hintPosition, 2)
  assert.equal(observed.decision.trigger, 'repeated-wrong-position')
  state = applyReviewHintDecision(state, observed.decision)
  assert.equal(state.stage, 'hint-0')
  assert.equal(state.stageWrongCount, 0)
  assert.deepEqual(state.forcedRevealPositions, [2])
  assert.ok(reviewHintTerminationVariant(state) < beforeColdAdvance)

  const automaticStages = [
    { from: 'hint-0', to: 'hint-1', level: 1 },
    { from: 'hint-1', to: 'hint-2', level: 2 },
    { from: 'hint-2', to: 'hint-3', level: 3 },
  ] as const

  for (const expected of automaticStages) {
    assert.equal(state.stage, expected.from)
    const before = reviewHintTerminationVariant(state)

    const first = observeReviewHintWrong({
      state,
      wrongIndex: 0,
      wordLength: 6,
    })
    state = first.state
    assert.equal(first.decision, null)
    assert.equal(state.stageWrongCount, 1)

    const second = observeReviewHintWrong({
      state,
      wrongIndex: 1,
      wordLength: 6,
    })
    state = second.state
    assert.equal(second.decision?.kind, 'advance-hint')
    if (second.decision?.kind !== 'advance-hint') return
    assert.equal(second.decision.level, expected.level)
    assert.equal(second.decision.to, expected.to)
    assert.equal(second.decision.trigger, 'repeated-hint-errors')

    state = applyReviewHintDecision(state, second.decision)
    assert.equal(state.stage, expected.to)
    assert.equal(state.stageWrongCount, 0)
    assert.ok(reviewHintTerminationVariant(state) < before)
  }

  for (let repeat = 0; repeat < 4; repeat += 1) {
    const terminal = observeReviewHintWrong({
      state,
      wrongIndex: repeat % 2,
      wordLength: 6,
    })
    state = terminal.state
    assert.equal(terminal.decision, null)
    assert.equal(state.stage, 'hint-3')
  }
})

test('forced reveal positions are retained at every non-terminal Hint level', () => {
  const hint0 = createReviewHintPlan(0, 6, 3, [1, 4])
  assert.deepEqual(hint0.condition.letters.visiblePositions, [1, 3, 4])

  const hint1 = createReviewHintPlan(1, 6, 3, [1, 4])
  assert.deepEqual(hint1.condition.letters.visiblePositions, [1, 3, 4])

  const hint2 = createReviewHintPlan(2, 6, 3, [1, 4])
  assert.deepEqual(hint2.condition.letters.visiblePositions, [0, 1, 2, 3, 4])

  const hint3 = createReviewHintPlan(3, 6, 3, [1, 4])
  assert.deepEqual(hint3.condition.letters, { mode: 'all-visible' })
})

test('cold-probe surrender remains Again even when final hint-assisted typing is clean', () => {
  const evidence = evaluateReviewEvidence(
    {
      exerciseCondition: createReviewHintPlan(3, 6).condition,
      learningContext: {
        version: 1,
        reviewHint: {
          version: 1,
          maxLevel: 3,
          coldProbeSurrendered: true,
          advanceCount: 4,
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
  assert.ok(evidence.reasonCodes.includes('cold-probe-surrendered'))

  assert.equal(
    reviewOutcomeForAttempt({
      classification: {
        cause: 'clean',
        confidence: 0.9,
        scores: { recall: 0, spelling: 0, motor: 0 },
      },
      evidence,
      condition: createReviewHintPlan(3, 6).condition,
    }),
    'again',
  )
})


test('Learn lifecycle excludes, preserves history state, ignores Typing, and restores due-now', () => {
  const base = createInitialReviewWordState('cet4', 'cancel', 100)
  const reviewed = {
    ...base,
    nextReviewAt: 500,
    reviewCount: 4,
    lapseCount: 2,
    cleanStreak: 1,
    lastOutcome: 'hard' as const,
    schedulerState: {
      kind: 'basic-v1' as const,
      stage: 2,
      intervalDays: 7,
    },
  }

  assert.equal(getLearningLifecycle(reviewed), 'active')

  const excluded = decideLearningLifecycleTransition(reviewed, {
    kind: 'exclude',
    now: 200,
  })
  assert.equal(getLearningLifecycle(excluded), 'excluded')
  assert.equal(excluded.reviewCount, 4)
  assert.equal(excluded.lapseCount, 2)
  assert.equal(excluded.schedulerState.stage, 2)
  assert.deepEqual(excluded.exclusion, {
    reason: 'manual',
    excludedAt: 200,
  })

  const afterTyping = decideLearningLifecycleTransition(excluded, {
    kind: 'typing-observation',
  })
  assert.equal(afterTyping, excluded)
  assert.equal(getLearningLifecycle(afterTyping), 'excluded')

  const restored = decideLearningLifecycleTransition(excluded, {
    kind: 'restore',
    now: 300,
  })
  assert.equal(getLearningLifecycle(restored), 'active')
  assert.equal(restored.nextReviewAt, 300)
  assert.equal(restored.reviewCount, 4)
  assert.equal(restored.lapseCount, 2)
  assert.equal(restored.schedulerState.stage, 2)
  assert.equal(restored.exclusion, undefined)
})

test('Learn selection excludes manually excluded states in due and force modes', () => {
  const active = createInitialReviewWordState('cet4', 'active', 100)
  const excluded = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'excluded', 100),
    { kind: 'exclude', now: 110 },
  )
  const candidates = [
    { word: 'active' },
    { word: 'excluded' },
  ]

  assert.deepEqual(
    selectReviewCandidates(candidates, [active, excluded], 100, 'due'),
    [{ word: 'active' }],
  )
  assert.deepEqual(
    selectReviewCandidates(candidates, [active, excluded], 100, 'force'),
    [{ word: 'active' }],
  )
})

test('pruning an excluded word removes all session duplicates and preserves logical cursor', () => {
  const word = (name: string) => ({
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  })
  const record = {
    id: 7,
    dict: 'cet4',
    index: 2,
    createTime: 1,
    isFinished: false,
    words: [word('a'), word('x'), word('x'), word('b')],
    exercisePlans: {
      x: createCanonicalReviewProbePlan(),
      b: createCanonicalReviewProbePlan(),
    },
    reinforcementCounts: {
      x: 1,
    },
    acquisitionStates: {
      x: createLearnAcquisitionState(),
    },
  }

  const pruned = pruneLearnSessionWord(record, 'x')
  assert.deepEqual(
    pruned.words.map((item) => item.name),
    ['a', 'b'],
  )
  assert.equal(pruned.index, 1)
  assert.equal(pruned.isFinished, false)
  assert.equal(pruned.exercisePlans?.x, undefined)
  assert.equal(pruned.reinforcementCounts?.x, undefined)
  assert.equal(pruned.acquisitionStates?.x, undefined)
})


test('Learn acquisition starts with visible confidence-building exposure', () => {
  const plan = createLearnAcquisitionPlan()

  assert.equal(plan.condition.purpose, 'training')
  assert.equal(plan.condition.audio, 'automatic')
  assert.equal(plan.condition.meaning, 'visible')
  assert.equal(plan.condition.phonetic, 'visible')
  assert.deepEqual(plan.condition.letters, { mode: 'all-visible' })
  assert.equal(plan.condition.probeDimension, 'none')
  assert.equal(
    plan.decision.policyVersion,
    'learn-acquisition-exposure-v1',
  )
  assert.ok(plan.decision.reasonCodes.includes('visible-copy'))
})

test('Learn acquisition separates exposure, support and delayed independent recall', () => {
  let state = createLearnAcquisitionState()
  assert.equal(state.phase, 'exposure')

  state = decideLearnAcquisitionTransition(state, {
    kind: 'exposure-complete',
  })
  assert.equal(state.phase, 'guided')

  state = decideLearnAcquisitionTransition(state, {
    kind: 'guided-committed',
  })
  assert.equal(state.phase, 'supported')
  assert.equal(
    createLearnAcquisitionExercisePlan(state.phase).condition.letters.mode,
    'all-hidden',
  )

  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })
  assert.equal(state.phase, 'independent')
  assert.equal(
    createLearnAcquisitionExercisePlan(state.phase).condition.purpose,
    'probe',
  )

  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: true,
  })
  assert.equal(state.phase, 'complete')
})

test('assisted independent recall returns to support and then defers instead of fabricating mastery', () => {
  let state = createLearnAcquisitionState()
  state = decideLearnAcquisitionTransition(state, {
    kind: 'exposure-complete',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'guided-committed',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })

  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: false,
  })
  assert.equal(state.phase, 'supported')
  assert.equal(state.assistedCycles, 1)

  state = decideLearnAcquisitionTransition(state, {
    kind: 'supported-complete',
  })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete',
    independentClean: false,
  })
  assert.equal(state.phase, 'deferred')
  assert.equal(state.assistedCycles, 2)
})

test('Learn acquisition follow-ups are spaced by intervening queue items', () => {
  const queue = [
    { name: 'a' },
    { name: 'b' },
    { name: 'c' },
    { name: 'd' },
    { name: 'e' },
  ]
  const supported = {
    ...createLearnAcquisitionState(),
    phase: 'supported' as const,
  }
  const first = projectLearnAcquisitionProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: supported,
  })
  assert.equal(first.index, 1)
  assert.equal(first.insertWord?.index, 3)
  assert.deepEqual(
    first.queue.map((item) => item.name),
    ['a', 'b', 'c', 'a', 'd', 'e'],
  )

  const independent = {
    ...supported,
    phase: 'independent' as const,
  }
  const second = projectLearnAcquisitionProgress({
    queue: first.queue,
    currentIndex: 3,
    currentWord: first.queue[3],
    nextState: independent,
  })
  assert.equal(second.insertWord?.index, first.queue.length)
  assert.equal(second.interveningItemsBeforeFollowUp, 2)

  const spacedIndependent = {
    ...independent,
    independentInterveningItems:
      second.interveningItemsBeforeFollowUp,
  }
  assert.equal(hasSufficientIndependentSpacing(spacedIndependent), true)
  assert.ok(
    createLearnAcquisitionExercisePlan('independent', {
      independentInterveningItems:
        second.interveningItemsBeforeFollowUp,
    }).decision.reasonCodes.includes('spacing-eligible'),
  )
})

test('Independent acquisition cannot admit from a one-word short-term loop', () => {
  const word = { name: 'solo' }
  const independent = {
    ...createLearnAcquisitionState(),
    phase: 'independent' as const,
  }
  const projection = projectLearnAcquisitionProgress({
    queue: [word],
    currentIndex: 0,
    currentWord: word,
    nextState: independent,
  })

  assert.equal(projection.interveningItemsBeforeFollowUp, 0)
  const shortSpaced = {
    ...independent,
    independentInterveningItems:
      projection.interveningItemsBeforeFollowUp,
  }
  assert.equal(hasSufficientIndependentSpacing(shortSpaced), false)

  const plan = createLearnAcquisitionExercisePlan('independent', {
    independentInterveningItems:
      projection.interveningItemsBeforeFollowUp,
  })
  assert.ok(plan.decision.reasonCodes.includes('spacing-insufficient'))
  assert.equal(
    plan.decision.reasonCodes.includes('spacing-eligible'),
    false,
  )

  const deferred = deferLearnAcquisitionForSpacing(shortSpaced, 100)
  assert.equal(deferred.phase, 'deferred')
  assert.equal(deferred.deferredReason, 'spacing')
  assert.equal(deferred.assistedCycles, 0)
  assert.equal(resumeSpacingDeferredAcquisition(deferred, 399), undefined)

  const resumed = resumeSpacingDeferredAcquisition(deferred, 400)
  assert.ok(resumed)
  assert.equal(resumed.phase, 'independent')
  assert.equal(resumed.assistedCycles, 0)
  assert.equal(hasSufficientIndependentSpacing(resumed), true)
})

test('Learn stats count only spacing-valid Independent acquisition as mastery', () => {
  const now = Math.floor(new Date(2026, 9, 4, 12, 0, 0).getTime() / 1000)
  const record = (
    word: string,
    reasonCodes: string[],
  ): IWordRecord => ({
    word,
    timeStamp: now - 10,
    dict: 'spacing-stats',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion: 'learn-acquisition-independent-v1',
      reasonCodes,
      conditionVersion: 1,
    },
    reviewEvidence: {
      version: 2,
      memoryGrade: 'good',
      retrievalValidity: 'independent',
      evidenceStrength: 1,
      reasonCodes: ['test-independent'],
    },
  })

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'spacing-stats',
    wordRecords: [
      record('eligible', ['spacing-eligible']),
      record('too-soon', ['spacing-insufficient']),
    ],
    wordStates: [],
    dictionaryWords: ['eligible', 'too-soon'],
  })

  assert.equal(stats.today.acquiredWords, 1)
  assert.equal(stats.dailyActivity30d.at(-1)?.acquired, 1)
})

test('legacy active state seeded only from Typing is removable ghost state', () => {
  const state = createInitialReviewWordState(
    'cet4',
    'typing-only',
    100,
  )
  state.updatedAt = 200
  state.nextReviewAt = 200

  const typingRecord: IWordRecord = {
    word: 'typing-only',
    timeStamp: 100,
    dict: 'cet4',
    chapter: 1,
    timing: [],
    wrongCount: 2,
    mistakes: { 0: ['x'] },
    sourceMode: 'typing',
  }

  assert.equal(
    shouldDropLegacyTypingSeededState(state, [typingRecord]),
    true,
  )

  const acquisitionRecord: IWordRecord = {
    ...typingRecord,
    chapter: -1,
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
  }

  assert.equal(
    shouldDropLegacyTypingSeededState(state, [
      typingRecord,
      acquisitionRecord,
    ]),
    false,
  )
})

test('duplicate dictionary names collapse into one Learn spelling memory with merged translations', () => {
  const words = [
    {
      name: 'bank',
      trans: ['n. 河岸'],
      usphone: 'bæŋk',
      ukphone: 'bæŋk',
    },
    {
      name: 'break',
      trans: ['v. 打破'],
      usphone: 'breɪk',
      ukphone: 'breɪk',
    },
    {
      name: 'bank',
      trans: ['n. 银行'],
      usphone: 'bæŋk',
      ukphone: 'bæŋk',
    },
  ]

  const canonical = canonicalizeLearningWords(words)

  assert.deepEqual(
    canonical.map((word) => word.name),
    ['bank', 'break'],
  )
  assert.deepEqual(canonical[0].trans, ['n. 河岸', 'n. 银行'])
})

test('Learn canonicalization merges rich fields without mutating the source dictionary', () => {
  const words = [
    {
      name: 'bank',
      trans: ['n. 河岸'],
      usphone: '',
      ukphone: '',
      example: [
        {
          en: 'They sat on the bank.',
          cn: '他们坐在河岸上。',
          start: 16,
          end: 20,
        },
      ],
      tags: ['textbook-a'],
    },
    {
      name: 'bank',
      trans: ['n. 银行'],
      usphone: '',
      ukphone: '',
      example: [
        {
          en: 'She works at a bank.',
          cn: '她在银行工作。',
          start: 15,
          end: 19,
        },
      ],
      tags: ['textbook-b'],
    },
  ]
  const original = structuredClone(words)

  const canonical = canonicalizeLearningWords(words)

  assert.equal(canonical.length, 1)
  assert.equal(canonical[0].example?.length, 2)
  assert.deepEqual(canonical[0].tags, ['textbook-a', 'textbook-b'])
  assert.deepEqual(words, original)
})

test('dictionary examples may cue an inflected surface while the spelling target remains name', () => {
  const word = {
    name: 'admit',
    trans: ['v. 承认'],
    usphone: '',
    ukphone: '',
    example: [
      {
        en: 'He finally admitted that he had made a mistake.',
        cn: '他最终承认自己犯了一个错误。',
        start: 11,
        end: 19,
      },
    ],
  }

  const example = getFirstValidDictionaryExample(word)
  assert.ok(example)
  if (!example) return

  const masked = maskDictionaryExample(example)
  assert.equal(masked.surface, 'admitted')
  assert.equal(word.name, 'admit')
  assert.equal(
    masked.before + masked.masked + masked.after,
    'He finally ________ that he had made a mistake.',
  )
})

test('invalid dictionary example ranges degrade to no-example without rejecting the word', () => {
  const word = {
    name: 'legacy-safe',
    trans: ['兼容'],
    usphone: '',
    ukphone: '',
    example: [
      {
        en: 'Example sentence.',
        cn: '例句。',
        start: 99,
        end: 120,
      },
    ],
  }

  assert.equal(getFirstValidDictionaryExample(word), undefined)
})

test('UNSEEN count is derived from the actual dictionary, ignoring stale states and duplicate names', () => {
  const words = [
    { name: 'w0', trans: [], usphone: '', ukphone: '' },
    { name: 'w1', trans: [], usphone: '', ukphone: '' },
    { name: 'w1', trans: [], usphone: '', ukphone: '' },
    { name: 'w2', trans: [], usphone: '', ukphone: '' },
  ]
  const active = createInitialReviewWordState('cet4', 'w0', 1)
  const staleState = createInitialReviewWordState('cet4', 'removed-word', 1)
  const excludedStale = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'old-excluded-word', 1),
    { kind: 'exclude', now: 2 },
  )

  assert.equal(
    countUnseenLearningWords(words, [active, staleState, excludedStale]),
    2,
  )
  assert.deepEqual(
    selectUnseenLearningWords(
      words,
      [active, staleState, excludedStale],
      99,
    ).map((word) => word.name),
    ['w1', 'w2'],
  )
})

test('new-word acquisition selects only unseen words in dictionary order with a bounded batch', () => {
  const words = Array.from({ length: 30 }, (_, index) => ({
    name: 'w' + index,
    trans: [],
    usphone: '',
    ukphone: '',
  }))
  const active = createInitialReviewWordState('cet4', 'w0', 1)
  const excluded = decideLearningLifecycleTransition(
    createInitialReviewWordState('cet4', 'w2', 1),
    { kind: 'exclude', now: 2 },
  )

  const selected = selectUnseenLearningWords(
    words,
    [active, excluded],
  )

  assert.equal(selected.length, LEARN_NEW_WORD_BATCH_SIZE)
  assert.equal(selected[0].name, 'w1')
  assert.equal(selected.some((word) => word.name === 'w0'), false)
  assert.equal(selected.some((word) => word.name === 'w2'), false)
  assert.deepEqual(
    selected.slice(0, 4).map((word) => word.name),
    ['w1', 'w3', 'w4', 'w5'],
  )
})

test('acquisition WordRecord cannot be replayed as a spaced-review rating', () => {
  const acquisitionRecord: IWordRecord = {
    word: 'cancel',
    timeStamp: 100,
    dict: 'cet4',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    exerciseCondition: createLearnAcquisitionPlan().condition,
  }

  assert.equal(
    inferReviewOutcomeFromWordRecord(acquisitionRecord, []),
    undefined,
  )
})


test('Learn P2 aggregates lifecycle, due state, ratings and daily evidence without Typing leakage', () => {
  const nowDate = new Date(2026, 9, 3, 12, 0, 0)
  const now = Math.floor(nowDate.getTime() / 1000)
  const tenDaysAgo = new Date(nowDate)
  tenDaysAgo.setDate(nowDate.getDate() - 10)

  const wordRecords: IWordRecord[] = [
    {
      word: 'alpha',
      timeStamp: now - 60,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    },
    {
      word: 'beta',
      timeStamp: now - 50,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: true,
        rating: 'good',
        confidence: 1,
        reasonCodes: ['canonical-clean-retrieval'],
      },
    },
    {
      word: 'gamma',
      timeStamp: now - 40,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 0: [' '] },
      sourceMode: 'learn',
      learnItemKind: 'review',
      learningContext: {
        version: 1,
        reviewHint: {
          maxLevel: 1,
          coldProbeSurrendered: true,
          advanceCount: 2,
        },
      },
      reviewRatingDecision: {
        eligible: true,
        rating: 'again',
        confidence: 1,
        reasonCodes: ['cold-probe-surrendered'],
      },
    },
    {
      word: 'beta',
      timeStamp: now - 30,
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'non-cold-attempt',
        reasonCodes: ['non-cold-attempt'],
      },
    },
    {
      word: 'legacy',
      timeStamp: Math.floor(tenDaysAgo.getTime() / 1000),
      dict: 'p2',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      reviewRatingDecision: {
        eligible: true,
        rating: 'easy',
        confidence: 1,
        reasonCodes: ['canonical-clean-retrieval'],
      },
    },
    {
      word: 'typing-noise',
      timeStamp: now - 20,
      dict: 'p2',
      chapter: 0,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'typing',
      reviewRatingDecision: {
        eligible: true,
        rating: 'easy',
        confidence: 1,
        reasonCodes: ['should-not-count'],
      },
    },
  ]

  const wordStates = [
    {
      ...createInitialReviewWordState('p2', 'alpha', now),
      nextReviewAt: now + 86400,
      schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 1 },
    },
    {
      ...createInitialReviewWordState('p2', 'beta', now),
      nextReviewAt: now - 1,
      schedulerState: { kind: 'basic-v2' as const, stage: 2, intervalDays: 3 },
    },
    {
      ...createInitialReviewWordState('p2', 'gamma', now),
      lifecycle: 'excluded' as const,
      nextReviewAt: now - 1,
      schedulerState: { kind: 'basic-v2' as const, stage: 1, intervalDays: 1 },
    },
    {
      ...createInitialReviewWordState('p2', 'delta', now),
      nextReviewAt: now + 604800,
      schedulerState: { kind: 'basic-v2' as const, stage: 3, intervalDays: 7 },
    },
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p2',
    wordRecords,
    wordStates,
    dictionaryWords: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
  })

  assert.equal(stats.today.reviewedWords, 2)
  assert.equal(stats.today.acquiredWords, 1)
  assert.equal(stats.today.hintUseRate, 33.3)
  assert.equal(stats.today.reviewAttempts, 2)
  assert.equal(stats.today.coldProbeAttempts, 2)
  assert.equal(stats.today.coldProbePassRate, 50)

  assert.deepEqual(stats.lifecycle, {
    active: 3,
    due: 1,
    difficultDue: 0,
    excluded: 1,
    unseen: 1,
  })
  assert.equal(stats.scheduler.averageIntervalDays, 3.7)
  assert.equal(stats.scheduler.ratedEvents30d, 3)
  assert.equal(stats.scheduler.successRate30d, 66.7)
  assert.deepEqual(stats.scheduler.ratings30d, {
    again: 1,
    hard: 0,
    good: 1,
    easy: 1,
  })

  const today = stats.dailyActivity30d.at(-1)
  assert.ok(today)
  assert.equal(today.reviewed, 2)
  assert.equal(today.acquired, 1)
  assert.equal(today.successRate, 50)
})

test('Learn P2 keeps UNSEEN unknown when the dictionary payload is unavailable', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p2',
    wordRecords: [],
    wordStates: [],
  })

  assert.equal(stats.lifecycle.unseen, null)
  assert.equal(stats.today.hintUseRate, null)
  assert.equal(stats.scheduler.successRate30d, null)
})


test('Learn interaction strain ignores Typing and stays unknown until enough Learn evidence exists', () => {
  const learnRecords: IWordRecord[] = Array.from(
    { length: 4 },
    (_, index) => ({
      word: `learn-${index}`,
      timeStamp: index + 1,
      dict: 'strain',
      chapter: -1,
      timing: [],
      wrongCount: 3,
      mistakes: { 0: ['x'] },
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
    }),
  )
  const typingRecords: IWordRecord[] = Array.from(
    { length: 10 },
    (_, index) => ({
      word: `typing-${index}`,
      timeStamp: 100 + index,
      dict: 'strain',
      chapter: 0,
      timing: [],
      wrongCount: 10,
      mistakes: { 0: ['x'] },
      sourceMode: 'typing',
    }),
  )

  const estimate = estimateLearnInteractionStrain([
    ...learnRecords,
    ...typingRecords,
  ])

  assert.equal(estimate.tier, 'unknown')
  assert.equal(estimate.score, null)
  assert.equal(estimate.sampleCount, 4)
})

test('Learn interaction strain caps bootstrap new words without touching Typing', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const wordRecords: IWordRecord[] = Array.from(
    { length: 5 },
    (_, index) => ({
      word: `strained-${index}`,
      timeStamp: now - (4 - index) * 30,
      dict: 'strain-quota',
      chapter: -1,
      timing: [],
      wrongCount: 3,
      mistakes: { 0: ['x'], 1: ['y'], 2: ['z'] },
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      learningContext: {
        version: 1,
        reviewHint: {
          version: 1,
          maxLevel: 3,
          coldProbeSurrendered: false,
          advanceCount: 4,
        },
      },
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 9_000,
        attempts: [
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
          {
            startLatencyMs: 3_000,
            durationMs: 1_000,
            correctPrefixLength: 0,
            result: 'wrong',
          },
        ],
      },
    }),
  )

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'strain-quota',
    wordRecords,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.strain.tier, 'recovery')
  assert.ok((stats.strain.score ?? 0) >= 0.55)
  assert.equal(quota.tier, 'low')
  assert.equal(quota.targetDailyNewWords, 5)
  assert.equal(quota.signals.strainTier, 'recovery')
  assert.ok(quota.reasonCodes.includes('interaction-strain-recovery'))
})

test('low interaction strain never increases the memory-based quota', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const wordRecords: IWordRecord[] = Array.from(
    { length: 5 },
    (_, index) => ({
      word: `fluent-${index}`,
      timeStamp: now - (4 - index) * 30,
      dict: 'strain-low',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 500,
        attempts: [
          {
            startLatencyMs: 500,
            durationMs: 1_000,
            correctPrefixLength: 5,
            result: 'clean',
          },
        ],
      },
    }),
  )

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'strain-low',
    wordRecords,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.strain.tier, 'low')
  assert.equal(quota.tier, 'high')
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(
    quota.reasonCodes.includes('interaction-strain-recovery'),
    false,
  )
})

test('Learn P3 keeps the 20-word bootstrap target when review history is insufficient', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: [],
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })

  const quota = decideDailyAcquisitionQuota(stats)
  assert.equal(quota.tier, 'high')
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(quota.allowedNow, 20)
  assert.ok(quota.reasonCodes.includes('bootstrap-insufficient-rated-history'))
})

test('Learn P3 reduces the daily new-word target to 5 under high Again pressure', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `review-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3',
    chapter: -1,
    timing: [],
    wrongCount: index < 4 ? 1 : 0,
    mistakes: index < 4 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision:
      index < 4
        ? {
            eligible: true as const,
            rating: 'again' as const,
            confidence: 1,
            reasonCodes: ['test-again'],
          }
        : {
            eligible: true as const,
            rating: 'good' as const,
            confidence: 1,
            reasonCodes: ['test-good'],
          },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.signals.againRate30d, 40)
  assert.equal(quota.tier, 'low')
  assert.equal(quota.targetDailyNewWords, 5)
  assert.equal(quota.allowedNow, 5)
  assert.ok(quota.reasonCodes.includes('high-again-rate'))
})

test('Learn P3 uses 10 words for moderate review pressure and never exceeds remaining daily quota', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = [
    ...Array.from({ length: 10 }, (_, index) => ({
      word: `review-${index}`,
      timeStamp: now - index * 60,
      dict: 'p3',
      chapter: -1,
      timing: [],
      wrongCount: index < 2 ? 1 : 0,
      mistakes: index < 2 ? { 0: ['x'] } : {},
      sourceMode: 'learn' as const,
      learnItemKind: 'review' as const,
      reviewRatingDecision:
        index < 2
          ? {
              eligible: true as const,
              rating: 'again' as const,
              confidence: 1,
              reasonCodes: ['test-again'],
            }
          : {
              eligible: true as const,
              rating: 'good' as const,
              confidence: 1,
              reasonCodes: ['test-good'],
            },
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      word: `new-${index}`,
      timeStamp: now - index * 30,
      dict: 'p3',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn' as const,
      learnItemKind: 'acquisition' as const,
    })),
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.tier, 'medium')
  assert.equal(quota.targetDailyNewWords, 10)
  assert.equal(quota.remainingDailyNewWords, 3)
  assert.equal(quota.allowedNow, 3)
})

test('Learn P3 never admits new words while due Review backlog exists', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const dueState = {
    ...createInitialReviewWordState('p3', 'due-word', now),
    nextReviewAt: now - 1,
  }
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3',
    wordRecords: [],
    wordStates: [dueState],
    dictionaryWords: ['due-word', 'new-word'],
  })
  const quota = decideDailyAcquisitionQuota(stats)

  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(quota.remainingDailyNewWords, 1)
  assert.equal(quota.allowedNow, 0)
  assert.equal(quota.pausedByDue, true)
  assert.ok(quota.reasonCodes.includes('due-review-first'))
})


test('Learn P3 can throttle from five valid cold probes before the 30-day sample reaches eight', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 5 }, (_, index) => ({
    word: `cold-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3-cold',
    chapter: -1,
    timing: [],
    wrongCount: index < 3 ? 1 : 0,
    mistakes: index < 3 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision:
      index < 3
        ? {
            eligible: true as const,
            rating: 'again' as const,
            confidence: 1,
            reasonCodes: ['cold-fail'],
          }
        : {
            eligible: true as const,
            rating: 'good' as const,
            confidence: 1,
            reasonCodes: ['cold-pass'],
          },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3-cold',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const decision = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.today.coldProbeAttempts, 5)
  assert.equal(stats.today.coldProbePassRate, 40)
  assert.equal(decision.tier, 'low')
  assert.equal(decision.targetDailyNewWords, 5)
  assert.ok(decision.reasonCodes.includes('low-cold-probe-pass-rate'))
})

test('Learn P3 excludes invalid Rating Gate events from cold-probe quality', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 5 }, (_, index) => ({
    word: `invalid-${index}`,
    timeStamp: now - index * 60,
    dict: 'p3-invalid',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: false as const,
      rating: null,
      reason: 'attention-uncertain' as const,
      reasonCodes: ['attention-uncertain'],
    },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p3-invalid',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })
  const decision = decideDailyAcquisitionQuota(stats)

  assert.equal(stats.today.reviewAttempts, 5)
  assert.equal(stats.today.coldProbeAttempts, 0)
  assert.equal(stats.today.coldProbePassRate, null)
  assert.equal(decision.tier, 'high')
  assert.ok(
    decision.reasonCodes.includes('bootstrap-insufficient-rated-history'),
  )
})


test('Learn P4 aggregates phased Acquisition effort per word instead of per attempt', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const phases = ['exposure', 'supported', 'independent'] as const
  const wordRecords: IWordRecord[] = phases.map((phase, index) => {
    const plan = createLearnAcquisitionExercisePlan(phase)
    return {
      word: 'environment',
      timeStamp: now - index * 30,
      dict: 'p4-phased-acquisition',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      exerciseCondition: plan.condition,
      reviewPolicyDecision: plan.decision,
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 2_000,
        attempts: [
          {
            startLatencyMs: 2_000,
            durationMs: 8_000,
            correctPrefixLength: 11,
            result: 'clean',
          },
        ],
      },
    }
  })

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-phased-acquisition',
    wordRecords,
    wordStates: [],
    dictionaryWords: ['environment'],
  })

  assert.equal(stats.effort.todayActiveSeconds, 30)
  assert.equal(stats.effort.medianAcquisitionSeconds, 30)
  assert.equal(stats.effort.recentAcquisitionSamples, 1)
})

test('Learn P4 uses fallback timing for a new user and plans the full 20-word bootstrap', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4',
    wordRecords: [],
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.action, 'acquire-new')
  assert.equal(plan.newWordTarget, 20)
  assert.equal(plan.plannedRemainingNewWords, 20)
  assert.equal(plan.allowedNewWordsNow, 20)
  assert.equal(plan.timeModel.reviewSecondsPerWord, 15)
  assert.equal(plan.timeModel.acquisitionSecondsPerWord, 30)
  assert.equal(plan.estimatedNewMinutes, 10)
})

test('Learn P4 uses personal median active time and caps new words after a heavy Review day', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `review-${index}`,
    timeStamp: now - index * 60,
    dict: 'p4-heavy',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 10_000,
      attempts: [
        {
          startLatencyMs: 10_000,
          durationMs: 80_000,
          correctPrefixLength: 5,
          result: 'clean',
        },
      ],
    },
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['p4-good'],
    },
  }))

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-heavy',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: Array.from({ length: 100 }, (_, index) => `w${index}`),
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(stats.effort.todayActiveSeconds, 900)
  assert.equal(stats.effort.medianReviewSeconds, 90)
  assert.equal(quota.targetDailyNewWords, 20)
  assert.equal(plan.todayActiveMinutes, 15)
  assert.equal(plan.plannedRemainingNewWords, 10)
  assert.equal(plan.allowedNewWordsNow, 10)
  assert.ok(plan.reasonCodes.includes('daily-workload-soft-budget'))
})

test('Learn P4 never truncates Due and projects its cost before new acquisition', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const states = Array.from({ length: 50 }, (_, index) => ({
    ...createInitialReviewWordState('p4-due', `due-${index}`, now),
    nextReviewAt: now - 1,
    lastOutcome: index < 8 ? ('hard' as const) : ('good' as const),
  }))
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-due',
    wordRecords: [],
    wordStates: states,
    dictionaryWords: [
      ...states.map((state) => state.word),
      ...Array.from({ length: 50 }, (_, index) => `new-${index}`),
    ],
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.action, 'review-due')
  assert.equal(plan.dueReviewWords, 50)
  assert.equal(plan.difficultDueWords, 8)
  assert.equal(plan.allowedNewWordsNow, 0)
  assert.equal(plan.estimatedDueMinutes, 12.5)
  assert.equal(plan.plannedRemainingNewWords, 15)
  assert.equal(plan.estimatedNewMinutes, 7.5)
  assert.equal(plan.estimatedRemainingMinutes, 20)
})

test('Learn P4 stops new admission after the soft daily workload budget is spent', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = Array.from({ length: 10 }, (_, index) => ({
    word: `spent-${index}`,
    timeStamp: now - index * 60,
    dict: 'p4-spent',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 20_000,
      attempts: [
        {
          startLatencyMs: 20_000,
          durationMs: 100_000,
          correctPrefixLength: 5,
          result: 'clean',
        },
      ],
    },
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['p4-good'],
    },
  }))
  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-spent',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })
  const quota = decideDailyAcquisitionQuota(stats)
  const plan = buildLearnDailyPlan({ stats, quota })

  assert.equal(plan.todayActiveMinutes, 20)
  assert.equal(plan.allowedNewWordsNow, 0)
  assert.equal(plan.action, 'complete')
  assert.ok(plan.reasonCodes.includes('daily-workload-budget-reached'))
})


test('Learn P4 workload includes reinforcement time without promoting it into Review quality metrics', () => {
  const now = Math.floor(new Date(2026, 9, 3, 12, 0, 0).getTime() / 1000)
  const records: IWordRecord[] = [
    {
      word: 'primary',
      timeStamp: now - 60,
      dict: 'p4-reinforcement',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 1000,
        attempts: [
          {
            startLatencyMs: 1000,
            durationMs: 9000,
            correctPrefixLength: 7,
            result: 'clean',
          },
        ],
      },
      reviewRatingDecision: {
        eligible: true,
        rating: 'good',
        confidence: 1,
        reasonCodes: ['primary'],
      },
    },
    {
      word: 'primary',
      timeStamp: now - 30,
      dict: 'p4-reinforcement',
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      sourceMode: 'learn',
      learnItemKind: 'review',
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: 1000,
        attempts: [
          {
            startLatencyMs: 1000,
            durationMs: 19000,
            correctPrefixLength: 7,
            result: 'clean',
          },
        ],
      },
      reviewRatingDecision: {
        eligible: false,
        rating: null,
        reason: 'non-cold-attempt',
        reasonCodes: ['reinforcement'],
      },
    },
  ]

  const stats = buildLearnStatsSnapshot({
    now,
    dict: 'p4-reinforcement',
    wordRecords: records,
    wordStates: [],
    dictionaryWords: ['new'],
  })

  assert.equal(stats.today.reviewAttempts, 1)
  assert.equal(stats.today.coldProbeAttempts, 1)
  assert.equal(stats.effort.recentReviewSamples, 1)
  assert.equal(stats.effort.medianReviewSeconds, 10)
  assert.equal(stats.effort.todayActiveSeconds, 30)
})
