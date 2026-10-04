import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectLearnSystemAnomalies,
} from './system-oracle'
import {
  runAcquisitionInteractionDriver,
} from './interaction-driver'
import type { Word } from '../../src/typings'

function word(name: string): Word {
  return {
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  }
}

test('event-level Virtual User drives the shared acquisition progression to finite completion', () => {
  const result = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
  })

  assert.equal(result.finished, true)
  assert.ok(result.interactions > 4)
  assert.ok(result.interactions < 100)

  const anomalies = detectLearnSystemAnomalies(result.events)
  assert.equal(
    anomalies.some(
      (item) => item.code === 'success-without-progress',
    ),
    false,
  )
})

test('generic oracle detects a dropped successful projection without knowing which interaction was mutated', () => {
  const result = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
    mutation: {
      stallInteraction: 2,
    },
  })

  const anomalies = detectLearnSystemAnomalies(result.events)
  const divergence = anomalies.find(
    (item) => item.code === 'controller-driver-divergence',
  )

  assert.ok(divergence)
  assert.equal(divergence.severity, 'high')
  assert.equal(divergence.eventIndex, 2)
})
