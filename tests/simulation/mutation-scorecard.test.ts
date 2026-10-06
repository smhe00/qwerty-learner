import assert from 'node:assert/strict'
import test from 'node:test'
import {
  P2_CRITICAL_FAULT_CATALOG,
  P2_FAULT_CATALOG_VERSION,
  P2_MUTATION_POLICY,
} from './fault-catalog'
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

function freshBudgetEvent(input: {
  allowedNow: number
  expectedAllowedNow: number
  freshSelected: number
  unseenCount?: number
  introducedToday?: number
  acquiredToday?: number
  readyPendingCount?: number
  pendingSelected?: number
  expectedPendingSelected?: number
}): LearnSystemTraceEvent {
  return {
    kind: 'fresh-budget',
    targetDailyNewWords: 20,
    introducedToday: input.introducedToday ?? 0,
    acquiredToday: input.acquiredToday ?? 0,
    unseenCount: input.unseenCount ?? 20,
    dueCount: 3,
    allowedNow: input.allowedNow,
    expectedAllowedNow: input.expectedAllowedNow,
    freshSelected: input.freshSelected,
    readyPendingCount: input.readyPendingCount ?? 0,
    pendingSelected: input.pendingSelected ?? 0,
    expectedPendingSelected:
      input.expectedPendingSelected ?? 0,
  }
}

function candidateEvent(input: {
  candidateKind: 'fresh' | 'pending' | 'due' | 'force'
  lifecycle:
    | 'unseen'
    | 'introduced'
    | 'pending'
    | 'admitted'
    | 'excluded'
  selectedCount?: number
  due?: boolean
}): LearnSystemTraceEvent {
  return {
    kind: 'candidate-selection',
    candidateKind: input.candidateKind,
    word: 'candidate',
    lifecycle: input.lifecycle,
    due: input.due ?? false,
    selectedCount: input.selectedCount ?? 1,
  }
}

function arbitrationEvent(input: {
  recoverableCount: number
  expectedSessionId: string | null
  decision:
    | 'restore'
    | 'new-review'
    | 'new-acquisition'
    | 'waiting'
  selectedSessionId: string | null
  selectedDict: string | null
  selectedFinished: boolean | null
  selectedCount: number
}): LearnSystemTraceEvent {
  return {
    kind: 'session-arbitration',
    activeDict: 'simulation',
    ...input,
  }
}

function mutationCases(): MutationCase[] {
  const stalled = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
    mutation: { stallInteraction: 2 },
  })

  return [
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
      id: 'success-without-semantic-progress',
      expected: 'success-without-progress',
      events: [
        {
          kind: 'attempt-completed',
          sessionKind: 'review',
          word: 'still',
          success: true,
          beforeIndex: 2,
          afterIndex: 2,
          expectedAfterIndex: 2,
          beforeQueueSignature: 'a|still|b',
          afterQueueSignature: 'a|still|b',
          expectedAfterQueueSignature: 'a|still|b',
          beforeItemStateSignature: 'same',
          afterItemStateSignature: 'same',
          afterFinished: false,
          expectedAfterFinished: false,
        },
      ],
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
      id: 'finished-checkpoint-resurrection',
      expected: 'checkpoint-regression',
      events: [
        {
          kind: 'checkpoint',
          action: 'save',
          sessionId: 'terminal-cp',
          index: 0,
          isFinished: true,
          queueSignature: 'omega',
          wordCount: 1,
        },
        {
          kind: 'checkpoint',
          action: 'restore',
          sessionId: 'terminal-cp',
          index: 0,
          isFinished: false,
          queueSignature: 'omega',
          wordCount: 1,
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
          allowedNewWordsNow: 4,
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
    {
      id: 'duplicate-logical-state-for-repeated-occurrence',
      expected: 'occurrence-identity-violation',
      events: [
        {
          kind: 'occurrence-identity',
          sessionId: 'occurrence-mutant',
          word: 'repeat',
          occurrenceCount: 2,
          logicalStateEntries: 2,
        },
      ],
    },
    {
      id: 'persistence-commit-before-request',
      expected: 'persistence-order-violation',
      events: [
        {
          kind: 'persistence-write',
          action: 'committed',
          sessionId: 'persist-a',
          sequence: 1,
          semanticSignature: 'one',
        },
      ],
    },
    {
      id: 'persistence-out-of-order-commit',
      expected: 'persistence-order-violation',
      events: [
        {
          kind: 'persistence-write',
          action: 'requested',
          sessionId: 'persist-b',
          sequence: 1,
          semanticSignature: 'one',
        },
        {
          kind: 'persistence-write',
          action: 'requested',
          sessionId: 'persist-b',
          sequence: 2,
          semanticSignature: 'two',
        },
        {
          kind: 'persistence-write',
          action: 'committed',
          sessionId: 'persist-b',
          sequence: 2,
          semanticSignature: 'two',
        },
        {
          kind: 'persistence-write',
          action: 'committed',
          sessionId: 'persist-b',
          sequence: 1,
          semanticSignature: 'one',
        },
      ],
    },
    {
      id: 'stranded-deferred-acquisition',
      expected: 'stranded-pending-acquisition',
      events: [
        {
          kind: 'acquisition-health',
          now: 1_000,
          opportunity: true,
          pending: [
            {
              word: 'deferred',
              phase: 'deferred',
              deferredReason: 'spacing',
              resumeAfter: null,
            },
          ],
        },
      ],
    },
    {
      id: 'pending-as-fresh',
      expected: 'candidate-lifecycle-violation',
      events: [
        candidateEvent({
          candidateKind: 'fresh',
          lifecycle: 'pending',
        }),
      ],
    },
    {
      id: 'admitted-as-fresh',
      expected: 'candidate-lifecycle-violation',
      events: [
        candidateEvent({
          candidateKind: 'fresh',
          lifecycle: 'admitted',
        }),
      ],
    },
    {
      id: 'excluded-word-selected',
      expected: 'candidate-lifecycle-violation',
      events: [
        candidateEvent({
          candidateKind: 'force',
          lifecycle: 'excluded',
        }),
      ],
    },
    {
      id: 'duplicate-canonical-selection',
      expected: 'candidate-lifecycle-violation',
      events: [
        candidateEvent({
          candidateKind: 'fresh',
          lifecycle: 'unseen',
          selectedCount: 2,
        }),
      ],
    },
    {
      id: 'fresh-selection-over-budget',
      expected: 'fresh-budget-violation',
      events: [
        freshBudgetEvent({
          allowedNow: 2,
          expectedAllowedNow: 2,
          freshSelected: 3,
        }),
      ],
    },
    {
      id: 'pending-consumes-fresh-budget',
      expected: 'fresh-budget-violation',
      events: [
        freshBudgetEvent({
          allowedNow: 2,
          expectedAllowedNow: 2,
          freshSelected: 1,
          readyPendingCount: 2,
          pendingSelected: 1,
          expectedPendingSelected: 2,
        }),
      ],
    },
    {
      id: 'quota-ignores-unseen-cap',
      expected: 'fresh-budget-violation',
      events: [
        freshBudgetEvent({
          allowedNow: 20,
          expectedAllowedNow: 1,
          freshSelected: 1,
          unseenCount: 1,
        }),
      ],
    },
    {
      id: 'acquired-vs-introduced-quota-accounting',
      expected: 'fresh-budget-violation',
      events: [
        freshBudgetEvent({
          allowedNow: 1,
          expectedAllowedNow: 0,
          freshSelected: 0,
          introducedToday: 20,
          acquiredToday: 19,
        }),
      ],
    },
    {
      id: 'finished-shadows-unfinished',
      expected: 'session-arbitration-violation',
      events: [
        arbitrationEvent({
          recoverableCount: 1,
          expectedSessionId: 'id:old',
          decision: 'waiting',
          selectedSessionId: null,
          selectedDict: null,
          selectedFinished: null,
          selectedCount: 0,
        }),
      ],
    },
    {
      id: 'oldest-unfinished-restored',
      expected: 'session-arbitration-violation',
      events: [
        arbitrationEvent({
          recoverableCount: 2,
          expectedSessionId: 'id:new',
          decision: 'restore',
          selectedSessionId: 'id:old',
          selectedDict: 'simulation',
          selectedFinished: false,
          selectedCount: 1,
        }),
      ],
    },
    {
      id: 'wrong-dictionary-restored',
      expected: 'session-arbitration-violation',
      events: [
        arbitrationEvent({
          recoverableCount: 1,
          expectedSessionId: 'id:expected',
          decision: 'restore',
          selectedSessionId: 'id:expected',
          selectedDict: 'other-dict',
          selectedFinished: false,
          selectedCount: 1,
        }),
      ],
    },
    {
      id: 'waiting-despite-unfinished',
      expected: 'session-arbitration-violation',
      events: [
        arbitrationEvent({
          recoverableCount: 1,
          expectedSessionId: 'id:expected',
          decision: 'waiting',
          selectedSessionId: null,
          selectedDict: null,
          selectedFinished: null,
          selectedCount: 0,
        }),
      ],
    },
  ]
}

function cleanControls(
  cleanInteraction: ReturnType<
    typeof runAcquisitionInteractionDriver
  >,
): LearnSystemTraceEvent[][] {
  return [
    cleanInteraction.events,
    [singletonEvent('single-legit', 10)],
    [
      {
        kind: 'checkpoint',
        action: 'save',
        sessionId: 'terminal-ok',
        index: 0,
        isFinished: true,
        queueSignature: 'omega',
        wordCount: 1,
      },
      {
        kind: 'lifecycle',
        action: 'route-enter',
        sessionId: null,
        isFinished: null,
      },
    ],
    [
      {
        kind: 'terminal-word-durable',
        sessionId: 'terminal-handoff-ok',
        word: 'omega',
        index: 2,
        queueLength: 3,
      },
      {
        kind: 'terminal-ui-finished',
        sessionId: 'terminal-handoff-ok',
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
    [
      {
        kind: 'occurrence-identity',
        sessionId: 'occurrence-clean',
        word: 'repeat',
        occurrenceCount: 3,
        logicalStateEntries: 1,
      },
    ],
    [
      {
        kind: 'persistence-write',
        action: 'requested',
        sessionId: 'persist-clean',
        sequence: 1,
        semanticSignature: 'one',
      },
      {
        kind: 'persistence-write',
        action: 'committed',
        sessionId: 'persist-clean',
        sequence: 1,
        semanticSignature: 'one',
      },
      {
        kind: 'persistence-write',
        action: 'requested',
        sessionId: 'persist-clean',
        sequence: 2,
        semanticSignature: 'two',
      },
      {
        kind: 'persistence-write',
        action: 'committed',
        sessionId: 'persist-clean',
        sequence: 2,
        semanticSignature: 'two',
      },
    ],
    [
      freshBudgetEvent({
        allowedNow: 3,
        expectedAllowedNow: 3,
        freshSelected: 2,
        readyPendingCount: 1,
        pendingSelected: 1,
        expectedPendingSelected: 1,
      }),
    ],
    [
      candidateEvent({
        candidateKind: 'pending',
        lifecycle: 'pending',
      }),
    ],
    [
      arbitrationEvent({
        recoverableCount: 1,
        expectedSessionId: 'id:newest',
        decision: 'restore',
        selectedSessionId: 'id:newest',
        selectedDict: 'simulation',
        selectedFinished: false,
        selectedCount: 1,
      }),
    ],
  ]
}

test('P2 mutation coverage contract kills every executable critical fault with zero clean false positives', () => {
  const cases = mutationCases()
  const catalogIds = new Set(
    P2_CRITICAL_FAULT_CATALOG.map((item) => item.id),
  )
  assert.equal(
    catalogIds.size,
    P2_CRITICAL_FAULT_CATALOG.length,
    'fault catalog ids must be unique',
  )

  const executableCritical = P2_CRITICAL_FAULT_CATALOG.filter(
    (item) =>
      item.severity === 'high' &&
      item.executableMutation,
  )
  assert.ok(
    executableCritical.length >=
      P2_MUTATION_POLICY.minExecutableCriticalFaults,
  )

  const caseIds = new Set(cases.map((item) => item.id))
  const missingExecutableFaults = executableCritical
    .map((item) => item.id)
    .filter((id) => !caseIds.has(id))
  assert.deepEqual(missingExecutableFaults, [])

  const unknownMutationIds = cases
    .map((item) => item.id)
    .filter((id) => !catalogIds.has(id))
  assert.deepEqual(unknownMutationIds, [])

  const results = cases.map((item) => {
    const anomalies = detectLearnSystemAnomalies(item.events)
    return {
      id: item.id,
      detected: anomalies.some(
        (anomaly) => anomaly.code === item.expected,
      ),
      expected: item.expected,
      codes: anomalies.map((anomaly) => anomaly.code),
    }
  })

  const detected = results.filter((item) => item.detected).length
  const criticalKillRate =
    executableCritical.length === 0
      ? 0
      : detected / executableCritical.length

  const cleanInteraction = runAcquisitionInteractionDriver({
    words: ['alpha', 'beta', 'gamma', 'delta'].map(word),
    now: 1_000,
  })
  const controls = cleanControls(cleanInteraction)
  const falsePositiveResults = controls.map((events, index) => ({
    index,
    codes: detectLearnSystemAnomalies(events).map(
      (item) => item.code,
    ),
  }))
  const falsePositives = falsePositiveResults.filter(
    (item) => item.codes.length > 0,
  ).length

  const disposition = Object.fromEntries(
    ['covered', 'partial', 'uncovered', 'out-of-scope'].map(
      (status) => [
        status,
        P2_CRITICAL_FAULT_CATALOG.filter(
          (item) => item.status === status,
        ).length,
      ],
    ),
  )

  console.log(
    'P2_MUTATION_COVERAGE',
    JSON.stringify({
      catalogVersion: P2_FAULT_CATALOG_VERSION,
      catalogTotal: P2_CRITICAL_FAULT_CATALOG.length,
      executableCritical: executableCritical.length,
      detected,
      criticalKillRate,
      falsePositives,
      cleanControls: controls.length,
      disposition,
      results,
      falsePositiveResults,
    }),
  )

  assert.equal(
    criticalKillRate,
    P2_MUTATION_POLICY.requiredCriticalKillRate,
  )
  assert.equal(
    falsePositives,
    P2_MUTATION_POLICY.maxCleanFalsePositives,
  )
})
