import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineExerciseCondition } from '../../src/review/condition'
import { createBaselineReviewPolicyDecision } from '../../src/review/decision'
import { buildReviewObservation } from '../../src/review/observation'
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
