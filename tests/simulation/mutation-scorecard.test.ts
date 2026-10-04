import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectLearnSystemAnomalies,
  type LearnSystemAnomaly,
  type LearnSystemTraceEvent,
} from './system-oracle'
import { runAcquisitionInteractionDriver } from './interaction-driver'
import type { Word } from '../../src/typings'

function word(name: string): Word {
  return {
    name,
    trans: [],
    usphone: '',
    ukphone: '',
  }
}

type MutationCase = {
  id: string
  expected: LearnSystemAnomaly['code']
  events: LearnSystemTraceEvent[]
}

function singletonEvent(
  sessionId: string,
  unseenCount: number,
): LearnSystemTraceEvent {
  return {
    kind: 'session-prepared',
    source: 'acquisition',
    sessionKind: 'acquisition',
    sessionId,
    batchSize: 1,
    uniqueWords: 1,
    dueCount: 0,
    unseenCount,
    allowedNewWordsNow: 1,
    introducedToday: 19,
    acquiredToday: 19,
  }
}

test('system mutation scorecard detects generic failure classes without false positives on clean controls', () => {
  const stalled = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
    mutation: { stallInteraction: 2 },
  })

  const cases: MutationCase[] = [
    {
      id: 'repeated-singleton-selection',
      expected: 'repeated-singleton-acquisition',
      events: [
        singletonEvent('s1', 10),
        singletonEvent('s2', 9),
        singletonEvent('s3', 8),
      ],
    },
    {
      id: 'dropped-controller-projection',
      expected: 'controller-driver-divergence',
      events: stalled.events,
    },
    {
      id: 'stale-checkpoint-rollback',
      expected: 'checkpoint-regression',
      events: [
        {
          kind: 'checkpoint',
          action: 'save',
          sessionId: 'cp1',
          index: 5,
          isFinished: false,
          queueSignature: 'a|b|c|d|e|f',
          wordCount: 6,
        },
        {
          kind: 'checkpoint',
          action: 'restore',
          sessionId: 'cp1',
          index: 2,
          isFinished: false,
          queueSignature: 'a|b|c|d|e|f',
          wordCount: 6,
        },
      ],
    },
    {
      id: 'due-review-bypassed',
      expected: 'due-work-bypassed',
      events: [
        {
          kind: 'session-prepared',
          source: 'acquisition',
          sessionKind: 'acquisition',
          sessionId: 'due-bypass',
          batchSize: 4,
          uniqueWords: 4,
          dueCount: 3,
          unseenCount: 20,
          allowedNewWordsNow: 0,
          introducedToday: 2,
          acquiredToday: 2,
        },
      ],
    },
  ]

  const results = cases.map((item) => {
    const anomalies = detectLearnSystemAnomalies(item.events)
    return {
      id: item.id,
      detected: anomalies.some(
        (anomaly) => anomaly.code === item.expected,
      ),
      codes: anomalies.map((anomaly) => anomaly.code),
    }
  })

  const detected = results.filter((item) => item.detected).length
  const sensitivity = detected / cases.length

  const cleanInteraction = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
  })
  const cleanControls: LearnSystemTraceEvent[][] = [
    cleanInteraction.events,
    [singletonEvent('single-legit', 10)],
    [
      {
        kind: 'session-prepared',
        source: 'acquisition',
        sessionKind: 'acquisition',
        sessionId: 'pending-resume',
        batchSize: 1,
        uniqueWords: 1,
        dueCount: 0,
        unseenCount: 10,
        allowedNewWordsNow: 0,
        introducedToday: 20,
        acquiredToday: 19,
      },
    ],
    [
      {
        kind: 'checkpoint',
        action: 'save',
        sessionId: 'prune',
        index: 3,
        isFinished: false,
        queueSignature: 'a|b|c|d',
        wordCount: 4,
      },
      {
        kind: 'checkpoint',
        action: 'restore',
        sessionId: 'prune',
        index: 2,
        isFinished: false,
        queueSignature: 'a|c|d',
        wordCount: 3,
      },
    ],
  ]
  const falsePositives = cleanControls.filter(
    (events) => detectLearnSystemAnomalies(events).length > 0,
  ).length

  console.log(
    'SIM_MUTATION_SCORECARD',
    JSON.stringify({
      detected,
      total: cases.length,
      sensitivity,
      falsePositives,
      cleanControls: cleanControls.length,
      results,
    }),
  )

  assert.equal(detected, cases.length)
  assert.equal(sensitivity, 1)
  assert.equal(falsePositives, 0)
})
