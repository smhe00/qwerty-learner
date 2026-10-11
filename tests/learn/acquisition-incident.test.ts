import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLearnAcquisitionExercisePlanForState,
  deferredAcquisitionCohortResumeTimes,
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

for (const size of [1, 2, 3]) {
  test(`assistance-deferred tail of ${size} probes directly without a second spacing wait`, () => {
    const words = Array.from({ length: size }, (_, index) => ({ ...word, name: `tail-${index}` }))
    const pending = new Map(words.map((item, index) => [item.name, {
      version: 1 as const, phase: 'deferred' as const, assistedCycles: 7,
      scaffoldHintPosition: 2, deferredReason: 'assistance' as const,
      resumeAfter: NOW + index * 5,
    }]))
    const select = (now: number) => planLearnAcquisitionCandidates({
      words, states: [], pendingStates: pending, introducedWords: words.map(item => item.name), freshLimit: 0, now,
    })
    if (size > 1) assert.equal(select(NOW).resumed.length, 0, 'nearby deadlines stay in one cohort')
    const ready = select(NOW + (size - 1) * 5)
    assert.equal(ready.resumed.length, size)
    assert.deepEqual(ready.freshWords, [])
    for (const { word: item, state } of ready.resumed) {
      assert.equal(state.phase, 'independent')
      assert.equal(state.scaffoldHintPosition, undefined)
      const plan = createLearnAcquisitionExercisePlanForState(state)
      assert.equal(plan.condition.audio, 'none')
      assert.equal(plan.condition.letters.mode, 'all-hidden')
      assert.ok(plan.decision.reasonCodes.includes('spacing-eligible'))
      const record = attempt({ word: item.name, reviewPolicyDecision: plan.decision })
      const result = resolveLearnAcquisitionCompletion({
        queue: [item], currentIndex: 0, currentWord: item, state,
        acquisitionStates: { [item.name]: state }, record, now: NOW + 10,
      })
      assert.equal(result.shouldPersistAdmission, true)
      assert.equal(result.projection.isFinished, true)
      assert.equal(isCompletedAcquisitionRecord(record), true)
      const failed = resolveLearnAcquisitionCompletion({
        queue: [item], currentIndex: 0, currentWord: item, state,
        acquisitionStates: { [item.name]: state }, record: { ...record, wrongCount: 1 }, now: NOW + 10,
      })
      assert.equal(failed.shouldPersistAdmission, false)
      assert.equal(failed.nextState.deferredReason, 'assistance')
      assert.equal(failed.nextState.resumeAfter, NOW + 310)
    }
  })
}

test('deadline cohorts are bounded and shared by waiting and selection', () => {
  const pending = new Map([0, 20, 40, 60].map((offset, index) => [`word-${index}`, {
    ...independent, phase: 'deferred' as const, deferredReason: 'spacing' as const, resumeAfter: NOW + offset,
  }]))
  assert.deepEqual([...deferredAcquisitionCohortResumeTimes(pending).values()], [NOW + 20, NOW + 20, NOW + 60, NOW + 60])
  const words = [...pending.keys()].map(name => ({ ...word, name }))
  const selected = planLearnAcquisitionCandidates({
    words, states: [], pendingStates: pending, introducedWords: [], freshLimit: 0, now: NOW + 20,
  })
  assert.deepEqual(selected.resumed.map(item => item.word.name), ['word-0', 'word-1'])
  assert.equal(resumeDeferredAcquisition(pending.get('word-1')!, NOW + 19), undefined)
  assert.equal(pending.get('word-0')!.phase, 'deferred', 'historical checkpoint stays immutable')
})

for (const size of [1, 2, 3, 5]) {
  test(`continuous ${size}-word tail finishes with real intervening practice, without advancing time`, () => {
    const targets = Array.from({ length: size }, (_, i) => ({
      ...word,
      name: `tail-${i}`,
    }))
    const spacingWords = ['known-a', 'known-b'].map((name) => ({
      ...word,
      name,
    }))
    let queue = targets
    let index = 0
    let states: Record<string, LearnAcquisitionState> = Object.fromEntries(
      targets.map((item) => [
        item.name,
        {
          version: 1,
          phase: 'supported',
          assistedCycles: 7,
        },
      ]),
    )
    const admitted = new Set<string>()
    let practiceCount = 0
    for (let step = 0; step < 60; step++) {
      const current = queue[index]
      const state = states[current.name]
      const plan = createLearnAcquisitionExercisePlanForState(state)
      const record = attempt({
        word: current.name,
        reviewPolicyDecision: plan.decision,
        learnItemKind: state.spacingOnly ? 'practice' : 'acquisition',
      })
      const result = resolveLearnAcquisitionCompletion({
        queue,
        currentIndex: index,
        currentWord: current,
        state,
        acquisitionStates: states,
        record,
        now: NOW,
        spacingWords,
      })
      assert.notEqual(result.nextState.phase, 'deferred')
      if (state.spacingOnly) {
        practiceCount++
        assert.equal(result.shouldPersistAdmission, false)
        assert.equal(isCompletedAcquisitionRecord(record), false)
      }
      if (result.shouldPersistAdmission) {
        assert.equal(state.phase, 'independent')
        assert.ok((state.independentInterveningItems ?? 0) >= 2)
        admitted.add(current.name)
      }
      states = result.acquisitionStates
      queue = result.projection.queue
      index = result.projection.index
      if (result.projection.isFinished) break
      assert.ok(step < 59, 'must terminate')
    }
    assert.deepEqual(
      [...admitted].sort(),
      targets.map((item) => item.name).sort(),
    )
    if (size <= 2) assert.ok(practiceCount >= 2)
    assert.equal(
      collectPendingAcquisitionStates({
        records: [checkpoint({ acquisitionStates: states })],
        wordRecords: [],
        wordStates: [],
      }).has('known-a'),
      false,
    )
  })
}

test('future deferred five-word cohort continues Supported with zero fresh quota and known practice pool', () => {
  const targets = Array.from({ length: 5 }, (_, i) => ({
    ...word,
    name: `tail-${i}`,
  }))
  const known = ['known-a', 'known-b'].map((name) => ({ ...word, name }))
  const pendingStates = new Map(
    targets.map((item) => [
      item.name,
      {
        ...independent,
        phase: 'deferred' as const,
        deferredReason: 'assistance' as const,
        resumeAfter: NOW + 300,
      },
    ]),
  )
  const states = known.map((item) =>
    createInitialReviewWordState('incident', item.name, NOW),
  )
  const input = {
    words: [...targets, ...known],
    states,
    pendingStates,
    introducedWords: targets.map((item) => item.name),
    freshLimit: 0,
    now: NOW,
    continuous: true,
  }
  const plan = planLearnAcquisitionCandidates(input)
  assert.equal(plan.resumed.length, 5)
  assert.equal(plan.freshWords.length, 0)
  assert.ok(
    plan.resumed.every(
      (item) =>
        item.state.phase === 'supported' &&
        item.state.independentInterveningItems === undefined,
    ),
  )
  assert.equal(
    planLearnAcquisitionCandidates({
      ...input,
      states: states.map((state) => ({
        ...state,
        lifecycle: 'excluded' as const,
      })),
    }).resumed.length,
    0,
  )
})

test('repeated assistance uses real practice without granting Independent evidence or resetting quota counts', async () => {
  const { sanitizeLearnSessionLifecycle } = await import('../../src/learn/lifecycle')
  const { countLearnSessionAcquisitionWords, countLearnSessionLogicalWords } = await import('../../src/learn/session')
  const known = ['known-a', 'known-b'].map(name => ({ ...word, name }))
  const state: LearnAcquisitionState = { ...independent, assistedCycles: 7 }
  const result = resolveLearnAcquisitionCompletion({
    queue: [word], currentIndex: 0, currentWord: word, state,
    acquisitionStates: { accurate: state }, record: attempt({ wrongCount: 1 }), now: NOW, spacingWords: known,
  })
  assert.equal(result.nextState.phase, 'supported')
  assert.equal(result.nextState.independentInterveningItems, undefined)
  assert.equal(result.shouldPersistAdmission, false)
  const record = checkpoint({ isFinished: false, index: result.projection.index,
    words: result.projection.queue, acquisitionStates: result.acquisitionStates, spacingWords: known })
  const states = known.map(item => createInitialReviewWordState('incident', item.name, NOW))
  const restored = sanitizeLearnSessionLifecycle(record, states)
  assert.deepEqual(restored.words, record.words)
  assert.equal(restored.index, record.index)
  assert.equal(countLearnSessionAcquisitionWords(restored), 1)
  assert.equal(countLearnSessionLogicalWords(restored), 1)
  const excluded = sanitizeLearnSessionLifecycle(record, states.map(item => ({ ...item, lifecycle: 'excluded' as const })))
  assert.equal(excluded.words.some(item => item.name === 'known-a'), false)
  assert.deepEqual(excluded.spacingWords, [])
})

test('practice mistakes and clean copies stay neutral through replay, daily and live statistics', async () => {
  const { inferReviewOutcomeFromWordRecord, reactivateReviewStateFromLearningEvidence, rebuildBasicStateFromWordRecords } = await import('../../src/review/rebuild')
  const { buildLearnStatsSnapshot } = await import('../../src/learn/stats')
  const { deriveLearnLiveStats } = await import('../../src/learn/live-stats')
  const clean = attempt({ learnItemKind: 'practice' })
  const wrong = { ...clean, wrongCount: 3 }
  const state = { ...createInitialReviewWordState('incident', word.name, NOW - 100), nextReviewAt: NOW + 86400 }
  assert.equal(inferReviewOutcomeFromWordRecord(wrong, []), undefined)
  assert.equal(reactivateReviewStateFromLearningEvidence(state, [wrong], NOW), state)
  assert.equal(rebuildBasicStateFromWordRecords('incident', word.name, [wrong, clean]), undefined)
  const stats = buildLearnStatsSnapshot({ now: NOW, dict: 'incident', wordRecords: [wrong, clean], wordStates: [state], dictionaryWords: [word.name] })
  assert.equal(stats.today.introducedWords, 0)
  assert.equal(stats.today.acquiredWords, 0)
  const live = deriveLearnLiveStats({ reviewRecord: checkpoint({ isFinished: false,
    acquisitionStates: { accurate: { ...independent, phase: 'complete', spacingOnly: true } } }), wordRecords: [clean, wrong] })
  assert.equal(live.totalLogicalWords, 0)
  assert.equal(live.completedLogicalWords, 0)
})
