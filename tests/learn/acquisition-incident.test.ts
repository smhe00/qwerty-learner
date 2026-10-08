import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLearnAcquisitionExercisePlanForState,
  resumeDeferredAcquisition,
} from '../../src/learn/acquisition'
import type { LearnAcquisitionState } from '../../src/learn/acquisition'
import { resolveLearnAcquisitionCompletion } from '../../src/learn/progression'
import { isCompletedAcquisitionRecord } from '../../src/learn/admission'
import {
  collectPendingAcquisitionStates,
  repairUnadmittedAcquisitionCheckpoint,
} from '../../src/learn/acquisition-recovery'
import { planLearnAcquisitionCandidates } from '../../src/learn/session'
import { createLearnDailySession, deriveLearnDailyProgress } from '../../src/learn/daily-session'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IWordRecord, IReviewRecord } from '../../src/utils/db/record'

const word = { name: 'accurate', trans: [], usphone: '', ukphone: '' }
const NOW = 1_800_000_000
const independent: LearnAcquisitionState = {
  version: 1, phase: 'independent', assistedCycles: 0, independentInterveningItems: 4,
}
function attempt(overrides: Partial<IWordRecord> = {}): IWordRecord {
  return {
    word: word.name, dict: 'incident', chapter: -1, timeStamp: NOW,
    timing: [], mistakes: {}, wrongCount: 0, sourceMode: 'learn', learnItemKind: 'acquisition',
    reviewPolicyDecision: createLearnAcquisitionExercisePlanForState(independent).decision,
    reviewEvidence: {
      version: 1, memoryGrade: 'good', errorCause: 'clean', confidence: 1,
      evidenceStrength: 1, retrievalValidity: 'independent', reasonCodes: [],
    }, ...overrides,
  }
}
function finish(record: IWordRecord, state = independent, queue = [word]) {
  return resolveLearnAcquisitionCompletion({
    queue, currentIndex: 0, currentWord: word, state,
    acquisitionStates: { accurate: state }, record, now: NOW,
  })
}
function checkpoint(overrides: Partial<IReviewRecord> = {}): IReviewRecord {
  return {
    dict: 'incident', createTime: NOW - 100, index: 0, words: [word], isFinished: true,
    sessionKind: 'acquisition', acquisitionStates: { accurate: { ...independent, phase: 'complete' } },
    ...overrides,
  }
}

test('incident ESC copy with zero wrong characters never completes Acquisition', () => {
  const record = attempt({
    reviewPolicyDecision: { version: 1, policyVersion: 'canonical-review-hint-v2', reasonCodes: [], conditionVersion: 1 },
    learningContext: {
      version: 1, answerRevealed: true,
      reviewHint: { version: 1, maxLevel: 3, coldProbeSurrendered: true, advanceCount: 1, failureCount: 0 },
    } as IWordRecord['learningContext'],
    reviewEvidence: {
      version: 1, memoryGrade: 'again', errorCause: 'recall', confidence: 1,
      evidenceStrength: 1, retrievalValidity: 'independent', reasonCodes: ['cold-probe-surrendered'],
    },
  })
  assert.equal(isCompletedAcquisitionRecord(record), false)
  assert.equal(finish(record).shouldPersistAdmission, false)
  assert.notEqual(finish(record).nextState.phase, 'complete')
})

test('completion, admission and Daily progress agree for valid independent evidence', () => {
  const record = attempt()
  const result = finish(record)
  assert.equal(result.shouldPersistAdmission, true)
  assert.equal(result.nextState.phase, 'complete')
  assert.equal(isCompletedAcquisitionRecord(record), true)
  const session = createLearnDailySession({
    dict: 'incident', now: NOW - 1, dailyNewTarget: 1, dictionaryWords: [word.name], wordRecords: [], wordStates: [],
  })
  assert.equal(deriveLearnDailyProgress({ session, wordRecords: [record] }).complete, true)
})

test('revealed, hinted, failed, assisted and mismatched evidence cannot complete Acquisition', () => {
  const base = attempt()
  const invalid: Partial<IWordRecord>[] = [
    { wrongCount: 1 },
    { word: 'another' },
    { learningContext: { version: 1, answerRevealed: true } as IWordRecord['learningContext'] },
    { learningContext: { version: 1, reviewHint: { version: 1, maxLevel: 0 } } as IWordRecord['learningContext'] },
    { reviewEvidence: { ...base.reviewEvidence!, errorCause: 'recall', memoryGrade: 'again' } },
    { reviewEvidence: { ...base.reviewEvidence!, retrievalValidity: 'assisted' } },
    { reviewPolicyDecision: { ...base.reviewPolicyDecision!, policyVersion: 'canonical-review-hint-v2' } },
  ]
  for (const overrides of invalid) assert.equal(finish(attempt(overrides)).shouldPersistAdmission, false)
  const missingSpacing = attempt({ reviewPolicyDecision: { ...base.reviewPolicyDecision!, reasonCodes: [] } })
  assert.equal(finish(missingSpacing).nextState.deferredReason, 'spacing')
  assert.equal(isCompletedAcquisitionRecord(missingSpacing), false)
})

test('incident false complete checkpoint remains selectable without fresh quota', () => {
  const records = [checkpoint()]
  const wordRecords = [attempt({ reviewPolicyDecision: {
    version: 1, policyVersion: 'canonical-review-hint-v2', reasonCodes: [], conditionVersion: 1,
  } })]
  const pending = collectPendingAcquisitionStates({ records, wordRecords, wordStates: [] })
  assert.equal(pending.get('accurate')?.phase, 'supported')
  const plan = planLearnAcquisitionCandidates({
    words: [word], states: [], pendingStates: pending, introducedWords: ['accurate'], freshLimit: 0, now: NOW,
  })
  assert.deepEqual(plan.resumed.map((item) => item.word.name), ['accurate'])
  assert.deepEqual(plan.freshWords, [])
  assert.equal(records[0].acquisitionStates?.accurate.phase, 'complete', 'history is immutable')
})

test('recovery never replays valid admission or exclusion and orders equal-time checkpoints by ID', () => {
  const records = [checkpoint({ id: 2 }), checkpoint({ id: 1, acquisitionStates: {
    accurate: { ...independent, phase: 'deferred', deferredReason: 'spacing', resumeAfter: NOW + 300 },
  } })]
  assert.equal(collectPendingAcquisitionStates({ records, wordRecords: [], wordStates: [] }).get('accurate')?.phase, 'supported')
  assert.equal(collectPendingAcquisitionStates({ records, wordRecords: [attempt()], wordStates: [] }).size, 0)
  const excluded = { ...createInitialReviewWordState('incident', 'accurate', NOW), lifecycle: 'excluded' as const }
  assert.equal(collectPendingAcquisitionStates({ records, wordRecords: [], wordStates: [excluded] }).size, 0)
})

test('unfinished ghost checkpoint repairs phase and appends lost work without resetting cursor', () => {
  const another = { ...word, name: 'another' }
  const record = checkpoint({ isFinished: false, index: 1, words: [word, another] })
  const pending = collectPendingAcquisitionStates({ records: [record], wordRecords: [], wordStates: [] })
  const repaired = repairUnadmittedAcquisitionCheckpoint(record, pending)
  assert.equal(repaired.index, 1)
  assert.deepEqual(repaired.words.map((item) => item.name), ['accurate', 'another', 'accurate'])
  assert.equal(repaired.acquisitionStates?.accurate.phase, 'supported')
  assert.equal(repaired.exercisePlans?.accurate.decision.policyVersion, 'learn-acquisition-supported-v1')
  assert.equal(repairUnadmittedAcquisitionCheckpoint(repaired, pending), repaired)
})

for (const length of [1, 2]) {
  test('Supported tail of ' + length + ' words defers once and later admits a clean spaced probe', () => {
    const queue = [word, ...Array.from({ length: length - 1 }, () => ({ ...word, name: 'another' }))]
    const supported: LearnAcquisitionState = { version: 1, phase: 'supported', assistedCycles: 4 }
    const result = finish(attempt(), supported, queue)
    assert.equal(result.nextState.phase, 'deferred')
    assert.equal(result.nextState.deferredReason, 'spacing')
    assert.equal(result.nextState.resumeAfter, NOW + 300)
    assert.deepEqual(result.projection.queue, queue, 'no doomed immediate follow-up')
    assert.equal(resumeDeferredAcquisition(result.nextState, NOW + 299), undefined)
    const resumed = resumeDeferredAcquisition(result.nextState, NOW + 300)!
    assert.equal(resumed.phase, 'independent')
    const record = attempt({ reviewPolicyDecision: createLearnAcquisitionExercisePlanForState(resumed).decision })
    assert.equal(finish(record, resumed).shouldPersistAdmission, true)
  })
}

test('deferring a short Supported tail removes an existing immediate repeat', () => {
  const state: LearnAcquisitionState = { version: 1, phase: 'supported', assistedCycles: 0 }
  const result = finish(attempt(), state, [word, word])
  assert.equal(result.projection.isFinished, true)
  assert.deepEqual(result.projection.queue, [word])
  assert.equal(result.nextState.deferredReason, 'spacing')
})
