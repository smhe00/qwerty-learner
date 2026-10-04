import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEARNER_PERSONAS,
  simulateLearner,
} from './learner-simulator'

test('longitudinal simulator is deterministic for a fixed seed', () => {
  const left = simulateLearner({
    persona: LEARNER_PERSONAS.balanced,
    seed: 42,
    days: 60,
    dictionarySize: 120,
  })
  const right = simulateLearner({
    persona: LEARNER_PERSONAS.balanced,
    seed: 42,
    days: 60,
    dictionarySize: 120,
  })

  assert.deepEqual(left.metrics, right.metrics)
  assert.deepEqual(left.daily, right.daily)
  assert.equal(left.wordRecords.length, right.wordRecords.length)
})

test('120-day learner personas produce plausible ordered outcomes and bounded workload', () => {
  const seeds = [11, 23, 37, 51]
  const run = (key: keyof typeof LEARNER_PERSONAS) =>
    seeds.map((seed) =>
      simulateLearner({
        persona: LEARNER_PERSONAS[key],
        seed,
        days: 120,
        dictionarySize: 240,
      }),
    )

  const strong = run('strong')
  const balanced = run('balanced')
  const weak = run('weakMemory')
  const fatigue = run('highFatigue')

  const mean = (
    runs: ReturnType<typeof run>,
    pick: (run: ReturnType<typeof simulateLearner>) => number,
  ) =>
    runs.reduce((sum, item) => sum + pick(item), 0) / runs.length

  const strongMastery = mean(strong, (item) => item.metrics.masteryRate)
  const balancedMastery = mean(
    balanced,
    (item) => item.metrics.masteryRate,
  )
  const weakMastery = mean(weak, (item) => item.metrics.masteryRate)

  assert.ok(strongMastery > balancedMastery)
  assert.ok(balancedMastery > weakMastery)

  const strongRetention = mean(
    strong,
    (item) => item.metrics.retentionAfter30d ?? 0,
  )
  const weakRetention = mean(
    weak,
    (item) => item.metrics.retentionAfter30d ?? 0,
  )
  assert.ok(strongRetention > weakRetention)

  for (const result of [
    ...strong,
    ...balanced,
    ...weak,
    ...fatigue,
  ]) {
    assert.ok(result.wordRecords.length > 0)
    assert.ok(result.wordStates.length > 0)
    assert.ok(result.metrics.reviewSuccessRate >= 0)
    assert.ok(result.metrics.reviewSuccessRate <= 1)
    assert.ok(result.metrics.lapseRate >= 0)
    assert.ok(result.metrics.lapseRate <= 1)
    assert.ok(result.metrics.maxDueBacklog <= 80)
    assert.ok(result.metrics.p95DailyInteractions <= 120)
  }

  const fatigueWork = mean(
    fatigue,
    (item) => item.metrics.meanDailyInteractions,
  )
  const balancedWork = mean(
    balanced,
    (item) => item.metrics.meanDailyInteractions,
  )
  assert.ok(fatigueWork >= balancedWork * 0.8)
})

test('simulated records remain consumable by Learn stats and scheduler state contracts', () => {
  const result = simulateLearner({
    persona: LEARNER_PERSONAS.balanced,
    seed: 7,
    days: 90,
    dictionarySize: 160,
  })

  for (const state of result.wordStates) {
    assert.equal(state.dict, 'simulation')
    assert.ok(state.nextReviewAt >= state.createdAt)
    assert.ok(state.reviewCount >= 0)
    assert.ok(state.lapseCount >= 0)
  }

  const acquisitions = result.wordRecords.filter(
    (record) => record.learnItemKind === 'acquisition',
  )
  const reviews = result.wordRecords.filter(
    (record) => record.learnItemKind === 'review',
  )
  assert.ok(acquisitions.length > 0)
  assert.ok(reviews.length > 0)
})
