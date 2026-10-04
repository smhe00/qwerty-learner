import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUPPORTED_WORD_METRICS,
  evaluateWordMetric,
} from '../../src/achievement/evaluator'
import { SUPPORTED_EVENT_METRICS } from '../../src/achievement/event-evaluator'
import { SUPPORTED_SESSION_METRICS } from '../../src/achievement/session-evaluator'
import { SUPPORTED_STATE_METRICS } from '../../src/achievement/state-evaluator'
import achievementData from '../../src/resources/achievementCulture/achievements.json'
import type { AchievementDefinition } from '../../src/resources/achievementCulture'
import type { IWordRecord } from '../../src/utils/db/record'

const achievements = achievementData as AchievementDefinition[]
const p0 = achievements.filter(
  (achievement) =>
    achievement.enabled && achievement.presentation.rollout === 'p0',
)

test('P0 evaluator exposes only explicitly supported metrics', () => {
  const isSupported = (metric: string) =>
    SUPPORTED_WORD_METRICS.has(metric) ||
    SUPPORTED_SESSION_METRICS.has(metric) ||
    SUPPORTED_STATE_METRICS.has(metric) ||
    SUPPORTED_EVENT_METRICS.has(metric)
  const supported = p0.filter((achievement) =>
    isSupported(achievement.condition.metric),
  )
  const unsupported = p0.filter(
    (achievement) => !isSupported(achievement.condition.metric),
  )

  assert.deepEqual(
    supported.map((item) => item.id).sort(),
    [
      'ACH_7_DAY',
      'ACH_7_OF_10',
      'ACH_AUDIO_10',
      'ACH_CONTINUE',
      'ACH_DAILY_GOAL',
      'ACH_ERROR_POSITION_FIXED',
      'ACH_FAILURE_RECOVERY_SESSION',
      'ACH_FIRST_DECODE',
      'ACH_HIDDEN_CRAFT',
      'ACH_HIDDEN_DAWN',
      'ACH_HINT_REDUCTION',
      'ACH_MASTERED_100',
      'ACH_NO_HINT_10',
      'ACH_RECOVER_1',
      'ACH_RECOVER_3',
      'ACH_TRUE_MEMORY',
      'ACH_WARMING_UP',
    ].sort(),
  )

  // The remaining P0 definitions require authoritative Unit membership.
  // They remain
  // disabled rather than being inferred from incomplete evidence.
  assert.equal(unsupported.length, 2)
})

test('unsupported metric evaluates to null instead of guessing', () => {
  const current: IWordRecord = {
    id: 1,
    word: 'alpha',
    timeStamp: 100,
    dict: 'test',
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
  }
  const unsupported = p0.find(
    (achievement) =>
      achievement.condition.metric ===
      'new_unit_learn_started',
  )
  assert.ok(unsupported)

  assert.equal(
    evaluateWordMetric(unsupported.condition, {
      current,
      records: [current],
      now: current.timeStamp,
    }),
    null,
  )
})

test('all permanent achievements remain unlock-once contracts', () => {
  for (const achievement of achievements) {
    assert.equal(achievement.unlockPolicy, 'once')
  }
})

test('hidden achievements never expose progress', () => {
  for (const achievement of achievements.filter((item) => item.hidden)) {
    assert.equal(achievement.presentation.progress, 'hidden')
  }
})
