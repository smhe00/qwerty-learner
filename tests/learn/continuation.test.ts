import assert from 'node:assert/strict'
import test from 'node:test'
import { hasLearnRetrySpacing, planLearnContinuation, rankLearnInterleavingWords } from '../../src/learn/continuation'
import { continueLearnDailyPlan, createLearnDailySession, deriveLearnDailyProgress, deriveLearnExecutionProgress, reconcileLearnDailySession, saveLearnDailySession } from '../../src/learn/daily-session'
import { prepareLearnSession } from '../../src/learn/controller'
import type { IReviewWordState } from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

const NOW = 1_800_000_000
const words = ['target', 'weak', 'strong', 'excluded', 'new-a', 'new-b'].map(name => ({ name, trans: [], usphone: '', ukphone: '' }))
function state(word: string, lapseCount = 0): IReviewWordState {
  return { dict: 'continue', word, createdAt: NOW - 1000, updatedAt: NOW - 1000, nextReviewAt: NOW + 86400,
    lifecycle: 'active', reviewCount: 2, lapseCount, cleanStreak: 0, stateVersion: 5,
    schedulerState: { kind: 'basic-v2', stage: 1, intervalDays: 1 } }
}
function record(word: string, timeStamp: number, overrides: Partial<IWordRecord> = {}): IWordRecord {
  return { dict: 'continue', word, timeStamp, chapter: -1, timing: [], wrongCount: 1, mistakes: {}, sourceMode: 'learn', learnItemKind: 'review', ...overrides }
}
function session() {
  return { ...createLearnDailySession({ dict: 'continue', now: NOW - 100, dailyNewTarget: 1, dictionaryWords: ['target'], wordRecords: [], wordStates: [] }),
    plannedNewWords: 0, plannedNewWordNames: [], plannedReviewWords: ['target'] }
}

test('retry spacing requires distinct actual Learn work or elapsed time, never reloads/Typing/future rows', () => {
  const attempted = record('target', NOW - 10)
  assert.equal(hasLearnRetrySpacing('target', [attempted], NOW), false)
  assert.equal(hasLearnRetrySpacing('target', [attempted, record('weak', NOW - 9), record('weak', NOW - 8)], NOW), false)
  assert.equal(hasLearnRetrySpacing('target', [attempted, record('weak', NOW - 9), record('strong', NOW - 8, { sourceMode: 'typing' })], NOW), false)
  assert.equal(hasLearnRetrySpacing('target', [attempted, record('weak', NOW - 9), record('strong', NOW + 1)], NOW), false)
  assert.equal(hasLearnRetrySpacing('target', [attempted, record('weak', NOW - 9), record('strong', NOW - 8)], NOW), true)
  assert.equal(hasLearnRetrySpacing('target', [attempted], NOW + 290), true)
})

test('whole-plan continuation retries future-due unfinished reviews only after real spacing', () => {
  const input = { session: session(), words, states: [state('target'), state('weak', 5), state('strong')], records: [record('target', NOW - 10)], now: NOW }
  assert.deepEqual(planLearnContinuation(input).readyReviews, [])
  assert.deepEqual(planLearnContinuation(input).spacingWords.map(word => word.name), ['weak', 'strong'])
  assert.deepEqual(planLearnContinuation({ ...input, records: [...input.records, record('weak', NOW - 9), record('strong', NOW - 8)] }).readyReviews.map(word => word.name), ['target'])
})

test('interleaving prioritizes weak active words and rotates the immediately previous filler', () => {
  const input = { words, states: [state('weak', 8), state('strong'), { ...state('excluded', 99), lifecycle: 'excluded' as const }], records: [], excludedNames: [] }
  assert.deepEqual(rankLearnInterleavingWords(input).map(word => word.name), ['weak', 'strong'])
  assert.deepEqual(rankLearnInterleavingWords({ ...input, records: [record('weak', NOW)] }).map(word => word.name), ['strong', 'weak'])
})

test('exclusions resolve execution targets without changing frozen identities or claiming mastery', () => {
  const original = { ...session(), plannedReviewWords: ['target', 'excluded'], plannedNewWords: 1, plannedNewWordNames: ['new-a'] }
  const current = reconcileLearnDailySession(original, [{ ...state('excluded'), lifecycle: 'excluded' }, { ...state('new-a'), lifecycle: 'excluded' }])
  const progress = deriveLearnDailyProgress({ session: current, wordRecords: [] })
  assert.equal(progress.targetWords, 1)
  assert.equal(progress.completedWords, 0)
  assert.deepEqual(current.plannedReviewWords, original.plannedReviewWords)
  assert.equal(deriveLearnDailyProgress({ session: reconcileLearnDailySession(current, [state('excluded'), state('new-a')]), wordRecords: [] }).targetWords, 3)
})

test('Continue migrates exhausted five-word boundaries to the whole unfinished plan', () => {
  const original = { ...session(), executionExhausted: true, plannedReviewWords: ['target', 'weak', 'strong'], extraRoundWordNames: ['weak'] }
  const current = continueLearnDailyPlan(original)
  assert.equal(current.executionExhausted, undefined)
  assert.equal(deriveLearnExecutionProgress({ session: current, wordRecords: [] }).targetWords, 3)
  assert.equal(continueLearnDailyPlan(current), current)
})

test('controller calls the generator for an exhausted daily plan without five-more or increasing the target', async () => {
  const storage = new Map<string, string>()
  const previous = globalThis.window
  globalThis.window = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } as unknown as Window & typeof globalThis
  try {
    saveLearnDailySession({ ...session(), executionExhausted: true, extraRoundWordNames: ['weak'] })
    let generated = false
    const result = await prepareLearnSession({ dictId: 'continue', words, errorEvidence: [], dependencies: {
      now: () => NOW, bootstrap: async () => {}, getLatestSession: async () => undefined,
      getWordRecords: async () => [record('target', NOW - 400)], getWordStates: async () => [state('target')],
      generateSession: async () => { generated = true; return { dict: 'continue', words: [words[0]], index: 0, createTime: NOW, isFinished: false, sessionKind: 'review' } as never },
      generateDueReview: async () => undefined, generateAcquisition: async () => undefined,
      getNextDeferredResumeAt: async () => undefined,
    } })
    assert.equal(generated, true)
    assert.equal(result.kind, 'session')
    assert.equal(result.diagnostics.dailySession?.plannedNewWords, 0)
    assert.equal(result.diagnostics.dailySession?.continueUnfinishedPlan, true)
  } finally {
    globalThis.window = previous
  }
})
