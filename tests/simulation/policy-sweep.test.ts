import assert from 'node:assert/strict'
import test from 'node:test'
import {
  learnAcquisitionQuotaPolicy,
} from '../../src/learn/quota'
import {
  defaultBasicReviewSchedulePolicy,
} from '../../src/review/scheduler'
import {
  LEARNER_PERSONAS,
  simulateLearner,
} from './learner-simulator'
import {
  DEFAULT_SIMULATION_POLICY_CANDIDATES,
  runPolicySweep,
} from './policy-sweep'

test('explicit default policies are bit-for-bit equivalent to implicit production defaults', () => {
  const implicit = simulateLearner({
    persona: LEARNER_PERSONAS.balanced,
    seed: 99,
    days: 75,
    dictionarySize: 140,
  })
  const explicit = simulateLearner({
    persona: LEARNER_PERSONAS.balanced,
    seed: 99,
    days: 75,
    dictionarySize: 140,
    schedulePolicy: defaultBasicReviewSchedulePolicy,
    quotaPolicy: learnAcquisitionQuotaPolicy,
  })

  assert.deepEqual(implicit.metrics, explicit.metrics)
  assert.deepEqual(implicit.daily, explicit.daily)
})

test('policy sweep evaluates all candidates without violating bounded-control envelopes', () => {
  const summaries = runPolicySweep({
    seeds: [3, 17],
    days: 100,
    dictionarySize: 180,
  })

  assert.equal(
    summaries.length,
    DEFAULT_SIMULATION_POLICY_CANDIDATES.length,
  )
  assert.deepEqual(
    [...summaries.map((item) => item.candidateId)].sort(),
    [...DEFAULT_SIMULATION_POLICY_CANDIDATES.map((item) => item.id)].sort(),
  )

  for (const summary of summaries) {
    assert.ok(Number.isFinite(summary.score))
    assert.ok(summary.meanRetention30d >= 0)
    assert.ok(summary.meanRetention30d <= 1)
    assert.ok(summary.meanMasteryRate >= 0)
    assert.ok(summary.meanMasteryRate <= 1)
    assert.ok(summary.meanLapseRate >= 0)
    assert.ok(summary.meanLapseRate <= 1)
    assert.ok(summary.meanDailyInteractions >= 0)
    assert.ok(summary.maxDueBacklog <= 80)
  }
})

test('interval candidates produce the expected retention-vs-load direction on balanced learners', () => {
  const candidate = Object.fromEntries(
    DEFAULT_SIMULATION_POLICY_CANDIDATES.map((item) => [
      item.id,
      item,
    ]),
  )
  const run = (id: string) => {
    const policy = candidate[id]
    return [5, 19, 41].map((seed) =>
      simulateLearner({
        persona: LEARNER_PERSONAS.balanced,
        seed,
        days: 120,
        dictionarySize: 220,
        schedulePolicy: policy.schedulePolicy,
        quotaPolicy: policy.quotaPolicy,
      }),
    )
  }
  const average = (
    runs: ReturnType<typeof run>,
    selector: (value: ReturnType<typeof simulateLearner>) => number,
  ) =>
    runs.reduce((sum, item) => sum + selector(item), 0) /
    runs.length

  const retentionFirst = run('retention-first')
  const loadFirst = run('load-first')

  const retentionLapse = average(
    retentionFirst,
    (item) => item.metrics.lapseRate,
  )
  const loadLapse = average(
    loadFirst,
    (item) => item.metrics.lapseRate,
  )
  const retentionWork = average(
    retentionFirst,
    (item) => item.metrics.meanDailyInteractions,
  )
  const loadWork = average(
    loadFirst,
    (item) => item.metrics.meanDailyInteractions,
  )

  assert.ok(retentionLapse <= loadLapse + 0.05)
  assert.ok(retentionWork >= loadWork * 0.85)
})
