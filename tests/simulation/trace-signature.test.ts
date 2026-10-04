import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LEARNER_PERSONAS,
  simulateLearner,
} from './learner-simulator'
import {
  buildTraceSignature,
  traceSignatureDistance,
} from './trace-signature'

test('trace signature is deterministic and preserves observable behavior differences', () => {
  const strong = simulateLearner({
    persona: LEARNER_PERSONAS.strong,
    seed: 13,
    days: 90,
    dictionarySize: 160,
  })
  const weak = simulateLearner({
    persona: LEARNER_PERSONAS.weakMemory,
    seed: 13,
    days: 90,
    dictionarySize: 160,
  })

  const strongSignature = buildTraceSignature(strong.wordRecords)
  const weakSignature = buildTraceSignature(weak.wordRecords)

  assert.ok(strongSignature.activeDays > 0)
  assert.ok(weakSignature.activeDays > 0)
  assert.ok(strongSignature.medianFirstKeyLatencyMs !== null)
  assert.ok(weakSignature.medianFirstKeyLatencyMs !== null)
  assert.ok(strongSignature.reviewSuccessRate !== null)
  assert.ok(weakSignature.reviewSuccessRate !== null)
  assert.notDeepEqual(strongSignature, weakSignature)

  assert.equal(
    traceSignatureDistance(strongSignature, strongSignature),
    0,
  )
  assert.ok(
    traceSignatureDistance(strongSignature, weakSignature) > 0,
  )
})
