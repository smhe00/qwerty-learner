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
    {
      id: 'final-word-durable-without-ui-finish',
      expected: 'terminal-handoff-stall',
      events: [
        {
          kind: 'terminal-word-durable',
          sessionId: 'terminal-stall',
          word: 'argue',
          index: 402,
          queueLength: 403,
        },
      ],
    },
    {
      id: 'stale-audio-owner',
      expected: 'audio-owner-mismatch',
      events: [
        {
          kind: 'audio-play',
          displayedWord: 'beta',
          displayedEpoch: 2,
          audioWord: 'alpha',
          audioEpoch: 1,
        },
      ],
    },
    {
      id: 'success-advance-before-audio-settles',
      expected: 'success-audio-lifecycle-violation',
      events: [
        {
          kind: 'success-advance',
          word: 'pronunciation',
          audioRequired: true,
          audioStarted: true,
          audioSettled: false,
          timeoutExpired: false,
          fastForward: false,
        },
      ],
    },
    {
      id: 'finished-session-route-resurrection',
      expected: 'terminal-session-resurrection',
      events: [
        {
          kind: 'checkpoint',
          action: 'save',
          sessionId: 'terminal-route',
          index: 0,
          isFinished: true,
          queueSignature: 'omega',
          wordCount: 1,
        },
        {
          kind: 'lifecycle',
          action: 'route-enter',
          sessionId: 'terminal-route',
          isFinished: false,
        },
      ],
    },
    {
      id: 'post-finish-evidence',
      expected: 'post-finish-evidence',
      events: [
        {
          kind: 'checkpoint',
          action: 'save',
          sessionId: 'terminal-evidence',
          index: 0,
          isFinished: true,
          queueSignature: 'omega',
          wordCount: 1,
        },
        {
          kind: 'learn-evidence-durable',
          sessionId: 'terminal-evidence',
          word: 'omega',
          itemKind: 'review',
        },
      ],
    },
    {
      id: 'wrong-mixed-item-ownership',
      expected: 'mixed-item-ownership-violation',
      events: [
        {
          kind: 'session-prepared',
          source: 'mixed',
          sessionKind: 'mixed',
          sessionId: 'mixed-owner',
          batchSize: 2,
          uniqueWords: 2,
          dueCount: 1,
          unseenCount: 1,
          allowedNewWordsNow: 1,
          introducedToday: 0,
          acquiredToday: 0,
          itemOwnership: [
            {
              word: 'review-word',
              itemKind: 'review',
              hasAcquisitionState: false,
            },
            {
              word: 'acq-word',
              itemKind: 'review',
              hasAcquisitionState: true,
            },
          ],
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
    [
      {
        kind: 'terminal-word-durable',
        sessionId: 'terminal-ok',
        word: 'omega',
        index: 2,
        queueLength: 3,
      },
      {
        kind: 'terminal-ui-finished',
        sessionId: 'terminal-ok',
      },
    ],
    [
      {
        kind: 'audio-play',
        displayedWord: 'beta',
        displayedEpoch: 2,
        audioWord: 'beta',
        audioEpoch: 2,
      },
      {
        kind: 'success-advance',
        word: 'beta',
        audioRequired: true,
        audioStarted: true,
        audioSettled: true,
        timeoutExpired: false,
        fastForward: false,
      },
    ],
    [
      {
        kind: 'session-prepared',
        source: 'mixed',
        sessionKind: 'mixed',
        sessionId: 'mixed-clean',
        batchSize: 2,
        uniqueWords: 2,
        dueCount: 1,
        unseenCount: 1,
        allowedNewWordsNow: 1,
        introducedToday: 0,
        acquiredToday: 0,
        itemOwnership: [
          {
            word: 'review-word',
            itemKind: 'review',
            hasAcquisitionState: false,
          },
          {
            word: 'acq-word',
            itemKind: 'acquisition',
            hasAcquisitionState: true,
          },
        ],
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
