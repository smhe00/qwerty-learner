import assert from 'node:assert/strict'
import test from 'node:test'
import { VirtualLearnApp } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'
import {
  createLearnAcquisitionState,
  decideLearnAcquisitionTransition,
  deferLearnAcquisitionForSpacing,
  scheduleAssistanceDeferredAcquisition,
  MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS,
  MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS,
} from '../../src/learn/acquisition'
import { planLearnAcquisitionCandidates, decideLearnStartKind } from '../../src/learn/session'
import { createLearnDailySession, deriveLearnDailyProgress } from '../../src/learn/daily-session'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import { buildLearnDailyPlan } from '../../src/learn/plan'
import { LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION } from '../../src/learn/acquisition'
import type { IWordRecord } from '../../src/utils/db/record'

const START = 1_800_000_000
const names = Array.from({ length: 48 }, (_, i) => 'coverageword' + String(i).padStart(2, '0'))
const words = names.map(name => ({ name, trans: [], usphone: '', ukphone: '' }))

test('C1/C2: independent recall failure re-teaches; second failure defers; resume after exactly 300s', () => {
  let state = createLearnAcquisitionState()
  state = decideLearnAcquisitionTransition(state, { kind: 'exposure-complete' })
  assert.equal(state.phase, 'guided')
  state = decideLearnAcquisitionTransition(state, { kind: 'guided-committed' })
  assert.equal(state.phase, 'supported')
  state = decideLearnAcquisitionTransition(state, { kind: 'supported-complete' })
  assert.equal(state.phase, 'independent')
  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete', independentClean: false, scaffoldHintPosition: 2,
  })
  assert.equal(state.phase, 'supported')
  state = decideLearnAcquisitionTransition(state, { kind: 'supported-complete' })
  state = decideLearnAcquisitionTransition(state, {
    kind: 'independent-complete', independentClean: false, scaffoldHintPosition: 3,
  })
  assert.equal(state.phase, 'deferred')
  assert.equal(state.deferredReason, 'assistance')
  const deferred = scheduleAssistanceDeferredAcquisition(state, START)
  assert.equal(deferred.resumeAfter, START + MIN_ASSISTANCE_DEFERRED_DELAY_SECONDS)
  const candidate = (now: number) => planLearnAcquisitionCandidates({
    words: words.slice(0, 4), states: [],
    pendingStates: new Map([[names[0], deferred]]),
    introducedWords: [names[0]], freshLimit: 0, now,
  })
  for (const delta of [0, 299]) {
    const pending = candidate(START + delta)
    assert.equal(pending.resumed.length, 0)
    assert.deepEqual(pending.blockedPendingWords, [names[0]])
    assert.equal(pending.freshWords.length, 0)
  }
  const ready = candidate(START + 300)
  assert.equal(ready.resumed.length, 1)
  assert.equal(ready.resumed[0].word.name, names[0])
  assert.equal(ready.resumed[0].state.phase, 'supported')
  assert.equal(ready.resumed[0].state.deferredReason, undefined)
})

test('C3: spacing deferral blocks too-early Independent and reinstates intervening-item gate', () => {
  const independent = {
    ...createLearnAcquisitionState(),
    phase: 'independent' as const,
    independentInterveningItems: 0,
  }
  const deferred = deferLearnAcquisitionForSpacing(independent, START)
  assert.equal(deferred.phase, 'deferred')
  assert.equal(deferred.deferredReason, 'spacing')
  const candidates = (now: number) => planLearnAcquisitionCandidates({
    words: words.slice(0, 1), states: [],
    pendingStates: new Map([[names[0], deferred]]),
    introducedWords: [names[0]], freshLimit: 0, now,
  })
  assert.equal(candidates(START + MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS - 1).resumed.length, 0)
  const ready = candidates(START + MIN_CROSS_SESSION_INDEPENDENT_DELAY_SECONDS)
  assert.equal(ready.resumed.length, 1)
  assert.equal(ready.resumed[0].state.phase, 'independent')
  assert.ok((ready.resumed[0].state.independentInterveningItems ?? 0) >= 2)
  assert.equal(ready.resumed[0].state.resumeAfter, undefined)
})

function admission(word: string, now: number, id: number): IWordRecord {
  return {
    id, word, dict: 'simulation', chapter: -1, timeStamp: now,
    timing: [500], wrongCount: 0, mistakes: {},
    sourceMode: 'learn', learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1, policyVersion: 'learn-acquisition-independent-v1',
      reasonCodes: ['spacing-eligible'], conditionVersion: 1,
    },
    reviewEvidence: {
      version: 1, memoryGrade: 'good', errorCause: 'clean',
      confidence: 1, retrievalValidity: 'independent', evidenceStrength: 1,
      reasonCodes: ['coverage-quota'],
    },
  }
}

test('C4: new-word quota saturates at 3/3, preserves progress, and renews tomorrow', () => {
  const today = createLearnDailySession({
    dict: 'simulation', now: START, dailyNewTarget: 3,
    dictionaryWords: names, wordRecords: [], wordStates: [],
  })
  assert.equal(today.plannedNewWords, 3)
  const history = names.slice(0, 4).map((name, i) =>
    admission(name, START + i + 1, i + 1))
  const progress = (count: number) => deriveLearnDailyProgress({
    session: today, wordRecords: history.slice(0, count),
  })
  assert.equal(progress(0).completedWords, 0)
  assert.equal(progress(2).completedWords, 2)
  assert.equal(progress(2).complete, false)
  assert.equal(progress(3).completedWords, 3)
  assert.equal(progress(3).complete, true)
  assert.equal(progress(4).completedWords, 3, 'cannot credit a fourth word to 3-word plan')
  const stats = buildLearnStatsSnapshot({
    now: START + 20, dict: 'simulation', wordRecords: history.slice(0, 3),
    wordStates: [], dictionaryWords: names,
  })
  const quota = decideDailyAcquisitionQuota(stats, undefined, 3)
  assert.equal(quota.remainingDailyNewWords, 0)
  assert.equal(quota.allowedNow, 0)
  assert.ok(quota.reasonCodes.includes('daily-new-word-target-reached'))
  const dailyPlan = buildLearnDailyPlan({ stats, quota })
  assert.equal(dailyPlan.allowedNewWordsNow, 0)
  assert.equal(dailyPlan.action, 'complete')
  const next = createLearnDailySession({
    dict: 'simulation', now: START + 86400, dailyNewTarget: 3,
    dictionaryWords: names, wordRecords: history.slice(0, 3), wordStates: [],
  })
  assert.notEqual(next.dateKey, today.dateKey)
  assert.equal(next.plannedNewWords, 3)
  const tomorrowStats = buildLearnStatsSnapshot({
    now: START + 86400, dict: 'simulation',
    wordRecords: history.slice(0, 3), wordStates: [], dictionaryWords: names,
  })
  assert.equal(decideDailyAcquisitionQuota(tomorrowStats, undefined, 3).remainingDailyNewWords, 3)
})

test('C5: natural next-day due review is first, rescheduled, and anomaly-free', async () => {
  const app = new VirtualLearnApp({ words: words.slice(0, 9), dailyNewWordTarget: 6 })
  app.seedAdmittedWords(3)
  assert.equal(app.wordStates.filter(s => s.nextReviewAt <= app.now).length, 0)
  app.advanceDays(1)
  assert.equal(app.wordStates.filter(s => s.nextReviewAt <= app.now).length, 3)
  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') throw new Error('natural due session missing')
  const current = prepared.record.words[prepared.record.index]
  assert.ok(current)
  assert.ok(names.slice(0, 3).includes(current.name), 'due item precedes unseen acquisition')
  assert.equal(prepared.record.itemKinds?.[current.name] ?? prepared.record.sessionKind, 'review')
  assert.equal(app.completeCurrentReview('good'), true)
  const next = app.wordStates.find(s => s.word === current.name)
  assert.ok(next)
  assert.ok(next.nextReviewAt > app.now)
  assert.deepEqual(detectLearnSystemAnomalies(app.events).map(x => x.code), [])
  console.log('[Explorer V3 coverage-gate]', JSON.stringify({
    asserted: [
      'failure-to-supported', 'assistance-defer-299/300s',
      'spacing-defer-299/300s', 'quota-exhaustion-and-no-overcredit',
      'next-day-quota-reset', 'natural-due-review-priority',
    ],
    count: 6,
  }))
})

/**
 * An introduction is *not* equivalent to successful Independent admission.
 * This exposes the previously surviving acquired-vs-introduced mutation.
 * The expected allowance is computed from the fixture, never by mirroring
 * the quota implementation or using its returned reason codes as the oracle.
 */
test('C6: daily allowance is constrained by introductions before independent admission', () => {
  const exposure: IWordRecord = {
    ...admission(names[0], START + 1, 201),
    reviewPolicyDecision: {
      version: 1,
      policyVersion: LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
      reasonCodes: ['coverage-exposure-only'],
      conditionVersion: 1,
    },
    reviewEvidence: undefined,
  }
  const now = START + 20
  const stats = buildLearnStatsSnapshot({
    now, dict: 'simulation', wordRecords: [exposure],
    wordStates: [], dictionaryWords: names,
  })
  assert.equal(stats.today.introducedWords, 1)
  assert.equal(stats.today.acquiredWords, 0)
  const allowance = decideDailyAcquisitionQuota(stats, undefined, 1)
  assert.equal(allowance.remainingDailyNewWords, 0,
    'an introduced word consumes today\'s quota even if it is not yet admitted')
  assert.equal(allowance.allowedNow, 0)
  const plan = buildLearnDailyPlan({ stats, quota: allowance })
  assert.equal(plan.allowedNewWordsNow, 0)
  assert.notEqual(plan.action, 'acquire-new')
})

/**
 * Due + unseen is a mixed session, not acquisition-only or due-only.
 * This explicitly kills the source mutation that previously survived
 * because the C5 one-word observation did not exercise decideLearnStartKind.
 */
test('C7: due Review combined with unseen Acquisition requires mixed start', () => {
  assert.equal(decideLearnStartKind({ dueCount: 3, unseenCount: 4 }), 'mixed')
  assert.equal(decideLearnStartKind({ dueCount: 3, unseenCount: 0 }), 'review')
  assert.equal(decideLearnStartKind({ dueCount: 0, unseenCount: 4 }), 'acquisition')
  assert.equal(decideLearnStartKind({ dueCount: 0, unseenCount: 0 }), 'empty')
})
