import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateWordMetric,
  SUPPORTED_WORD_METRICS,
} from '../../src/achievement/evaluator'
import achievementData from '../../src/resources/achievementCulture/achievements.json'
import type { AchievementDefinition } from '../../src/resources/achievementCulture'
import type { IWordRecord } from '../../src/utils/db/record'

const achievements = achievementData as AchievementDefinition[]
const p0 = achievements.filter(
  (achievement) =>
    achievement.enabled && achievement.presentation.rollout === 'p0',
)

test('P0 evaluator exposes only explicitly supported metrics', () => {
  const supported = p0.filter((achievement) =>
    SUPPORTED_WORD_METRICS.has(achievement.condition.metric),
  )
  const unsupported = p0.filter(
    (achievement) =>
      !SUPPORTED_WORD_METRICS.has(achievement.condition.metric),
  )

  assert.deepEqual(
    supported.map((item) => item.id).sort(),
    [
      'ACH_7_DAY',
      'ACH_7_OF_10',
      'ACH_ERROR_POSITION_FIXED',
      'ACH_FIRST_DECODE',
      'ACH_HIDDEN_CRAFT',
      'ACH_NO_HINT_10',
      'ACH_RECOVER_1',
      'ACH_RECOVER_3',
      'ACH_TRUE_MEMORY',
    ].sort(),
  )

  // The remaining P0 definitions require session, chapter/mastery, or richer
  // presentation-observation facts. They must remain disabled at runtime
  // rather than being inferred from incomplete evidence.
  assert.equal(unsupported.length, 10)
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
      'first_recommended_learn_goal_completed',
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
