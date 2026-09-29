import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineExerciseCondition } from '../../src/review/condition'
import { createBaselineReviewPolicyDecision } from '../../src/review/decision'
import { evaluateReviewEvidence } from '../../src/review/evidence'
import { chooseTargetedMaskPlan } from '../../src/review/exercise-policy'
import { buildReviewObservation } from '../../src/review/observation'
import { buildOrthographyProfile } from '../../src/review/profile'
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
