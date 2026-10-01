import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBaselineExerciseCondition,
  isLetterVisibleForExerciseCondition,
} from '../../src/review/condition'
import {
  createBaselineReviewPolicyDecision,
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
  decideReviewProgress,
  decideWordInput,
  shouldPlayAutomaticPronunciation,
} from '../../src/review/machine'
import {
  hasUnreviewedLearningFailure,
  inferReviewOutcomeFromWordRecord,
  reactivateReviewStateFromLearningEvidence,
  rebuildBasicStateFromWordRecords,
} from '../../src/review/rebuild'
import { buildOrthographyProfile } from '../../src/review/profile'
import {
  buildReviewSessionExercisePlans,
  getWordComponentInstanceKey,
} from '../../src/review/session'
import { reviewOutcomeForAttempt } from '../../src/review/scheduler'
import {
  CURRENT_REVIEW_STATE_VERSION,
  createInitialReviewWordState,
} from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

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

test('review session freezes the newest shadow per word and ignores legacy records', () => {
  const baseline = createBaselineExerciseCondition({
    pronunciationEnabled: true,
    meaningVisible: true,
    phoneticVisible: false,
    letterVisibility: [false, false, false, false],
  })
  const olderShadow = createReviewPolicyShadow(
    baseline,
    createBaselineReviewPolicyDecision(),
  )
  const newerCondition = {
    ...baseline,
    source: 'adaptive-policy' as const,
    letters: {
      mode: 'targeted-mask' as const,
      visiblePositions: [0, 1, 3],
      maskedPositions: [2],
    },
  }
  const newerShadow = createReviewPolicyShadow(
    newerCondition,
    {
      version: 1,
      policyVersion: 'targeted-mask-v1',
      reasonCodes: ['dominant-spelling-position'],
      conditionVersion: 1,
    },
  )

  const records: IWordRecord[] = [
    {
      id: 1,
      word: 'test',
      timeStamp: 1,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
      reviewPolicyShadow: olderShadow,
    },
    {
      id: 2,
      word: 'test',
      timeStamp: 2,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 2: ['x'] },
      reviewPolicyShadow: newerShadow,
    },
    {
      id: 3,
      word: 'legacy',
      timeStamp: 3,
      dict: 'cet4',
      chapter: -1,
      timing: [],
      wrongCount: 1,
      mistakes: { 0: ['x'] },
    },
  ]

  const plans = buildReviewSessionExercisePlans(
    [
      { name: 'test', trans: [], usphone: '', ukphone: '' },
      { name: 'legacy', trans: [], usphone: '', ukphone: '' },
    ],
    records,
  )

  assert.equal(Object.keys(plans).length, 1)
  assert.equal(plans.test.decision.policyVersion, 'targeted-mask-v1')
  assert.deepEqual(plans.test.condition.letters.maskedPositions, [2])
  assert.equal(plans.legacy, undefined)
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

test('a newer record without a shadow cancels an older session shadow', () => {
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

  assert.deepEqual(plans, {})
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


test('ordinary learning failure seeds an immediately due first review without advancing scheduler', () => {
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

  assert.ok(state)
  assert.equal(state.stateVersion, CURRENT_REVIEW_STATE_VERSION)
  assert.equal(state.nextReviewAt, dueNow)
  assert.equal(state.reviewCount, 0)
  assert.equal(state.lapseCount, 0)
  assert.equal(state.cleanStreak, 0)
  assert.equal(state.lastReviewedAt, undefined)
  assert.deepEqual(state.schedulerState, {
    kind: 'basic-v1',
    stage: 0,
    intervalDays: 0,
  })
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
    kind: 'basic-v1',
    stage: 0,
    intervalDays: 1,
  })
})

test('state version 4 forces existing version 3 review states to be stale', () => {
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


test('fresh ordinary-learning failure after Review reactivates due-now without changing scheduler history', () => {
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

  assert.equal(hasUnreviewedLearningFailure(records), true)

  const reactivated = reactivateReviewStateFromLearningEvidence(
    reviewed,
    records,
    400,
  )

  assert.equal(reactivated.nextReviewAt, 400)
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

test('force Review selects all current error candidates while due mode selects only due candidates', () => {
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
    ['due', 'future', 'missing'],
  )
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
