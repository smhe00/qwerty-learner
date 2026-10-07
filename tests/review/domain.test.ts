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
