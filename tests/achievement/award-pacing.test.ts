import assert from 'node:assert/strict'
import test from 'node:test'
import { planAchievementAwards } from '../../src/achievement/award-pacing'
import type { AchievementStateRecord, PendingAchievementAward } from '../../src/achievement/types'

const DAY = 86_400
const START = Math.floor(new Date(2026, 9, 16, 12, 0, 0).getTime() / 1000)
const award = (achievementId: string, when = START): PendingAchievementAward => ({
  achievementId, triggeredAt: when, firstTriggerEventId: 'word:42', metricValue: 1,
  sourceRecordId: 42,
})
const granted = (achievementId: string, when: number): AchievementStateRecord => ({
  achievementId, unlockedAt: when, firstTriggerEventId: 'word:42',
})

test('even exceptional same-day milestones grant at most one, preserving the rest', () => {
  const input = [award('ACH_FIRST_DECODE'), award('ACH_HIDDEN_DAWN'), award('ACH_7_DAY')]
  const first = planAchievementAwards({ now: START, unlockedStates: [], pending: [], newlyQualified: input })
  assert.equal(first.awarded?.achievementId, 'ACH_HIDDEN_DAWN')
  assert.equal(first.waiting.length, 2)
  assert.equal(first.awarded?.firstTriggerEventId, 'word:42')

  const sameDay = planAchievementAwards({
    now: START + 30, unlockedStates: [granted('ACH_HIDDEN_DAWN', START)],
    pending: first.waiting, newlyQualified: [input[1], input[0]],
  })
  assert.equal(sameDay.awarded, null)
  assert.equal(sameDay.waiting.length, 2)

  const nextDay = planAchievementAwards({
    now: START + DAY, unlockedStates: [granted('ACH_HIDDEN_DAWN', START)],
    pending: sameDay.waiting, newlyQualified: [],
  })
  assert.equal(nextDay.awarded?.achievementId, 'ACH_7_DAY')
  assert.equal(nextDay.waiting.length, 1)
  const dayThree = planAchievementAwards({
    now: START + 2 * DAY,
    unlockedStates: [granted('ACH_HIDDEN_DAWN', START), granted('ACH_7_DAY', START + DAY)],
    pending: nextDay.waiting, newlyQualified: [],
  })
  assert.equal(dayThree.awarded?.achievementId, 'ACH_FIRST_DECODE')
  assert.equal(dayThree.waiting.length, 0)
})

test('duplicate candidates, imported unlock state and unknown records cannot mint again', () => {
  const plan = planAchievementAwards({
    now: START + DAY,
    unlockedStates: [granted('ACH_FIRST_DECODE', START)],
    pending: [award('ACH_FIRST_DECODE'), award('ACH_RECOVER_1')],
    newlyQualified: [award('ACH_RECOVER_1'), award('ACH_NONEXISTENT')],
  })
  assert.equal(plan.awarded?.achievementId, 'ACH_RECOVER_1')
  assert.equal(plan.waiting.length, 0)
})

test('every-day payout schedule never exceeds one granted award per local day', () => {
  let pending = Array.from({ length: 19 }, (_, i) => {
    const ids = ['ACH_FIRST_DECODE', 'ACH_NEW_UNIT', 'ACH_NO_HINT_10',
      'ACH_RECOVER_1', 'ACH_DAILY_GOAL', 'ACH_7_DAY', 'ACH_MASTERED_100',
      'ACH_WARMING_UP', 'ACH_AUDIO_10', 'ACH_CONTINUE', 'ACH_ERROR_POSITION_FIXED',
      'ACH_RECOVER_3', 'ACH_FAILURE_RECOVERY_SESSION', 'ACH_HIDDEN_DAWN',
      'ACH_HIDDEN_CRAFT', 'ACH_HINT_REDUCTION', 'ACH_TRUE_MEMORY',
      'ACH_7_OF_10', 'ACH_CHAPTER_80']
    return award(ids[i])
  })
  const states: AchievementStateRecord[] = []
  for (let day = 0; day < 21; day++) {
    for (let event = 0; event < 10; event++) {
      const now = START + day * DAY + event
      const next = planAchievementAwards({ now, unlockedStates: states, pending, newlyQualified: [] })
      pending = next.waiting
      if (next.awarded) states.push(granted(next.awarded.achievementId, now))
    }
  }
  const dates = states.map(s => Math.floor((s.unlockedAt - START) / DAY))
  assert.equal(dates.length, 19)
  assert.equal(new Set(dates).size, 19)
  assert.equal(pending.length, 0)
})
