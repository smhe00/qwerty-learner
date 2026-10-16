import assert from 'node:assert/strict'
import test from 'node:test'
import { achievementEvidenceSatisfied, countEvidenceDays } from '../../src/achievement/eligibility'
import { achievementDefinitions } from '../../src/resources/achievementCulture'
import type { IWordRecord } from '../../src/utils/db/record'
import type { Word } from '../../src/typings'
import type { AchievementEventRecord } from '../../src/achievement/types'

const DAY = 86_400
const START = 1_700_000_000
const byId = (id: string) => {
  const found = achievementDefinitions.find((a) => a.id === id)
  assert.ok(found, 'missing ' + id)
  return found
}
function attempt(id: number, word = 'w' + id, day = 0, mode: 'learn' | 'typing' = 'learn',
  overrides: Partial<IWordRecord> = {}): IWordRecord {
  return {
    id, dict: 'dict', word, chapter: -1, timeStamp: START + day * DAY + id,
    wrongCount: 0, mistakes: {}, timing: [], sourceMode: mode,
    learningContext: { version: 1 },
    reviewEvidence: { version: 1, memoryGrade: 'good', retrievalValidity: 'independent',
      errorCause: 'clean', confidence: 1, evidenceStrength: 1, reasonCodes: [] },
    ...overrides,
  } as IWordRecord
}

test('first lasting badge requires 16 independent distinct Learn words; repetition and Typing do not farm', () => {
  const cond = byId('ACH_FIRST_DECODE').condition
  assert.equal(achievementEvidenceSatisfied(cond, Array.from({ length: 16 }, (_, i) => attempt(i + 1, 'same'))), false)
  assert.equal(achievementEvidenceSatisfied(cond, Array.from({ length: 16 }, (_, i) => attempt(i + 1))), true)
  assert.equal(achievementEvidenceSatisfied(cond, Array.from({ length: 15 }, (_, i) => attempt(i + 1))), false)
  assert.equal(achievementEvidenceSatisfied(cond, Array.from({ length: 16 }, (_, i) => attempt(i + 1, 'w' + i, 0, i === 15 ? 'typing' : 'learn'))), false)
})

test('recovery milestone needs six different failed then independently recovered words', () => {
  const cond = byId('ACH_RECOVER_1').condition
  const records = Array.from({ length: 6 }, (_, i) => [
    attempt(2 * i + 1, 'recover-' + i, 0, 'learn', { wrongCount: 1 }),
    attempt(2 * i + 2, 'recover-' + i, 1),
  ]).flat()
  assert.equal(achievementEvidenceSatisfied(cond, records.slice(0, -1)), false)
  assert.equal(achievementEvidenceSatisfied(cond, records), true)
  assert.equal(achievementEvidenceSatisfied(cond, records.map(r => ({ ...r, word: 'one-word' }))), false)
  const assisted = [...records]
  assisted[assisted.length - 1] = { ...assisted.at(-1)!, reviewRatingDecision: {
    eligible: false, rating: null, reason: 'training-event', reasonCodes: ['training-event'],
  } }
  assert.equal(achievementEvidenceSatisfied(cond, assisted), false)
})

test('new unit badge requires entering three distinct real dictionary units', () => {
  const cond = byId('ACH_NEW_UNIT').condition
  const dict = Array.from({ length: 60 }, (_, i) => ({
    name: 'w' + i, trans: [], usphone: '', ukphone: '',
  })) as Word[]
  const records = [attempt(1, 'w0'), attempt(2, 'w19'), attempt(3, 'w20')]
  assert.equal(achievementEvidenceSatisfied(cond, records, dict), false)
  assert.equal(achievementEvidenceSatisfied(cond, [...records, attempt(4, 'w40')], dict), true)
  assert.equal(achievementEvidenceSatisfied(cond, [...records, attempt(4, 'unknown')], dict), false)
})

test('no-hint streak must persist into a second actual Learn day', () => {
  const cond = byId('ACH_NO_HINT_10').condition
  const first = Array.from({ length: 64 }, (_, i) => attempt(i + 1))
  assert.equal(achievementEvidenceSatisfied(cond, first), false)
  assert.equal(achievementEvidenceSatisfied(cond, [...first, attempt(65, 'w65', 1)]), true)
})

test('goal and voluntary continuation count distinct local calendar days, not repeated sessions', () => {
  const goal = byId('ACH_DAILY_GOAL').condition
  const continueCond = byId('ACH_CONTINUE').condition
  assert.equal(goal.constraints.minGoalDays, 5)
  assert.equal(continueCond.constraints.minContinueDays, 3)
  const event = (id: number, day: number, metric: string): AchievementEventRecord => ({
    eventId: 'event:' + id, eventType: 'session_completed', origin: 'live',
    occurredAt: START + day * DAY + id,
    dict: 'dict', metricValues: { [metric]: 1 }, unlockedAchievementIds: [],
  })
  const metric = 'first_recommended_learn_goal_completed'
  const history = [event(1, 0, metric), event(2, 0, metric), event(3, 1, metric), event(4, 2, metric)]
  assert.equal(countEvidenceDays(history, metric, START + 3 * DAY, true), 4)
  assert.equal(countEvidenceDays(history, metric, START + 4 * DAY, true), 4 + 1)
  const continueMetric = 'voluntary_continue_after_session'
  assert.equal(countEvidenceDays([event(1, 0, continueMetric), event(2, 0, continueMetric)],
    continueMetric, START + DAY, true), 2)
  assert.equal(countEvidenceDays([event(1, 0, continueMetric), event(2, DAY, continueMetric)],
    continueMetric, START + 2 * DAY, true), 3)
})

test('P0 awards are no longer immediate single-word or one-click badges in normal flows', () => {
  assert.equal(byId('ACH_FIRST_DECODE').condition.constraints.minIndependentUniqueWords, 16)
  assert.equal(byId('ACH_NO_HINT_10').condition.target, 64)
  assert.equal(byId('ACH_ERROR_POSITION_FIXED').condition.target, 2)
  assert.equal(byId('ACH_AUDIO_10').condition.target, 48)
  assert.equal(byId('ACH_WARMING_UP').condition.constraints.minWords, 32)
})
