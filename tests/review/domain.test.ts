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

test('dynamic scaffold keeps acquisition boundaries and softens only Supported work', () => {
  const tiers = ['unknown', 'low', 'elevated', 'recovery'] as const

  for (const strainTier of tiers) {
    assert.equal(
      decideLearnScaffold({
        phase: 'exposure',
        strainTier,
        assistedCycles: 2,
      }).level,
      'S0',
    )
    assert.equal(
      decideLearnScaffold({
        phase: 'independent',
        strainTier,
        assistedCycles: 2,
      }).level,
      'S3',
    )
  }

  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'low',
      assistedCycles: 0,
    }).level,
    'S2',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'elevated',
      assistedCycles: 0,
    }).level,
    'S1',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'recovery',
      assistedCycles: 0,
    }).level,
    'S1',
  )
  assert.equal(
    decideLearnScaffold({
      phase: 'supported',
      strainTier: 'low',
      assistedCycles: 1,
    }).level,
    'S1',
  )
})

test('dynamic scaffold V1.1 targets a known wrong position without guessing', () => {
  assert.deepEqual(getLearnScaffoldPresentation('S1'), {
    purpose: 'training',
    audio: 'automatic',
    phonetic: 'visible',
    letters: { mode: 'all-hidden' },
  })
  assert.deepEqual(
    getLearnScaffoldPresentation('S1', { hintPosition: 2 }),
    {
      purpose: 'training',
      audio: 'automatic',
      phonetic: 'visible',
      letters: {
        mode: 'partial',
        visiblePositions: [2],
      },
    },
  )
  assert.deepEqual(getLearnScaffoldPresentation('S2'), {
    purpose: 'training',
    audio: 'none',
    phonetic: 'hidden',
    letters: { mode: 'all-hidden' },
  })

  const strong = createLearnAcquisitionExercisePlan('supported', {
    scaffoldStrainTier: 'low',
    scaffoldHintPosition: 2,
    assistedCycles: 0,
  })
  assert.equal(strong.condition.purpose, 'training')
  assert.equal(strong.condition.audio, 'automatic')
  assert.equal(strong.condition.phonetic, 'visible')
  assert.deepEqual(strong.condition.letters, {
    mode: 'partial',
    visiblePositions: [2],
  })
  assert.ok(strong.decision.reasonCodes.includes('dynamic-scaffold-s1'))
  assert.ok(
    strong.decision.reasonCodes.includes('position-targeted-support-2'),
  )

  const independent = createLearnAcquisitionExercisePlan('independent', {
    scaffoldStrainTier: 'recovery',
    assistedCycles: 2,
    independentInterveningItems: 2,
  })
  assert.equal(independent.condition.purpose, 'probe')
  assert.equal(independent.condition.audio, 'none')
  assert.equal(independent.condition.phonetic, 'hidden')
  assert.ok(
    independent.decision.reasonCodes.includes('dynamic-scaffold-s3'),
  )
  assert.ok(independent.decision.reasonCodes.includes('spacing-eligible'))
})

test('independent failure carries its last wrong position only into Supported scaffold', () => {
  const independent = {
    ...createLearnAcquisitionState({ scaffoldStrainTier: 'low' }),
    phase: 'independent' as const,
    independentInterveningItems: 4,
  }

  const supported = decideLearnAcquisitionTransition(independent, {
    kind: 'independent-complete',
    independentClean: false,
    scaffoldHintPosition: 2,
  })
  assert.equal(supported.phase, 'supported')
  assert.equal(supported.assistedCycles, 1)
  assert.equal(supported.scaffoldHintPosition, 2)

  const nextIndependent = decideLearnAcquisitionTransition(supported, {
    kind: 'supported-complete',
  })
  assert.equal(nextIndependent.phase, 'independent')
  assert.equal(nextIndependent.scaffoldHintPosition, undefined)
})

test('S1 scaffold starts Strong Hint and ESC surrenders directly to full answer', () => {
  const state = createReviewHintMachineState({
    initialLevel: 1,
    hintPosition: 2,
  })
  assert.equal(state.stage, 'hint-1')
  assert.equal(state.maxLevelReached, 1)
  assert.equal(state.failureCount, 2)
  assert.equal(state.hintPosition, 2)

  const decision = decideReviewHintInput({
    state,
    inputIndex: 0,
    key: 'Escape',
  })
  assert.equal(decision.kind, 'advance-hint')
  if (decision.kind !== 'advance-hint') return
  assert.equal(decision.from, 'hint-1')
  assert.equal(decision.to, 'hint-3')
  assert.equal(decision.level, 3)
  assert.equal(decision.hintPosition, 2)
  assert.equal(decision.failureCount, 2)
})

test('Recovery Window pulls only high-confidence training items ahead of a difficult retry', () => {
  const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name }))
  const current = {
    ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
    phase: 'supported' as const,
    assistedCycles: 1,
  }
  const acquisitionStates = {
    a: current,
    b: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'independent' as const,
    },
    c: createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
    d: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'supported' as const,
    },
    e: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
      phase: 'complete' as const,
    },
    f: createLearnAcquisitionState({ scaffoldStrainTier: 'recovery' }),
  }

  const plan = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: current,
    acquisitionStates,
  })

  assert.equal(plan.active, true)
  assert.equal(plan.targetSize, 3)
  assert.deepEqual(plan.selectedNames, ['c', 'd', 'f'])
  assert.equal(plan.selectedNames.includes('b'), false)
  assert.equal(plan.selectedNames.includes('e'), false)

  assert.deepEqual(
    applyLearnRecoveryWindow(queue, 0, plan.selectedNames).map(
      (item) => item.name,
    ),
    ['a', 'c', 'd', 'f', 'b', 'e'],
  )

  const projection = projectLearnAcquisitionProgress({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: current,
    acquisitionStates,
  })
  assert.deepEqual(
    projection.queue.map((item) => item.name),
    ['a', 'c', 'd', 'f', 'a', 'b', 'e'],
  )
  assert.equal(projection.interveningItemsBeforeFollowUp, 3)
  assert.deepEqual(projection.recoveryWindow?.selectedNames, ['c', 'd', 'f'])
})

test('Recovery Window is bounded by strain tier and never activates on low strain', () => {
  const queue = ['a', 'b', 'c', 'd'].map((name) => ({ name }))
  const exposureStates = Object.fromEntries(
    queue.map((item) => [
      item.name,
      createLearnAcquisitionState({ scaffoldStrainTier: 'elevated' }),
    ]),
  )

  const elevated = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'elevated' }),
      phase: 'supported',
      assistedCycles: 1,
    },
    acquisitionStates: exposureStates,
  })
  assert.equal(elevated.active, true)
  assert.equal(elevated.targetSize, 2)
  assert.deepEqual(elevated.selectedNames, ['b', 'c'])

  const low = planLearnRecoveryWindow({
    queue,
    currentIndex: 0,
    currentWord: queue[0],
    nextState: {
      ...createLearnAcquisitionState({ scaffoldStrainTier: 'low' }),
      phase: 'supported',
      assistedCycles: 1,
    },
    acquisitionStates: exposureStates,
  })
  assert.equal(low.active, false)
  assert.deepEqual(low.selectedNames, [])
})

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
