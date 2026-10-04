import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUPPORTED_WORD_METRICS,
  evaluateWordMetric,
} from '../../src/achievement/evaluator'
import { SUPPORTED_EVENT_METRICS } from '../../src/achievement/event-evaluator'
import { SUPPORTED_SESSION_METRICS } from '../../src/achievement/session-evaluator'
import { SUPPORTED_STATE_METRICS } from '../../src/achievement/state-evaluator'
import { SUPPORTED_UNIT_METRICS } from '../../src/achievement/unit-evaluator'
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
    SUPPORTED_EVENT_METRICS.has(metric) ||
    SUPPORTED_UNIT_METRICS.has(metric)
  const supported = p0.filter((achievement) =>
    isSupported(achievement.condition.metric),
  )
  const unsupported = p0.filter(
    (achievement) => !isSupported(achievement.condition.metric),
  )

  assert.equal(supported.length, p0.length)
  assert.equal(unsupported.length, 0)
  assert.equal(p0.length, 19)
})

test('unit metrics stay out of the generic word evaluator', () => {
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
  const unitMetric = p0.find(
    (achievement) =>
      achievement.condition.metric ===
      'new_unit_learn_started',
  )
  assert.ok(unitMetric)
  assert.ok(SUPPORTED_UNIT_METRICS.has(unitMetric.condition.metric))

  assert.equal(
    evaluateWordMetric(unitMetric.condition, {
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
