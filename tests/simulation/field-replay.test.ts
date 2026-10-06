import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEVELOPER_INCIDENT_SCHEMA,
  DiagnosticReplayError,
  createReplayableMinimizedExport,
  minimizeDiagnosticEvents,
  parseDiagnosticExport,
  replayDiagnostic,
} from '../../src/dev/replay'
import { DEVELOPER_TRACE_SCHEMA } from '../../src/dev/diagnostic-trace'

function event(
  sequence: number,
  name: string,
  input: {
    sessionId?: string
    word?: string
    index?: number
    queueLength?: number
    details?: Record<string, unknown>
    scope?: string
  } = {},
) {
  return {
    schemaVersion: 1,
    sequence,
    at: 1_000 + sequence,
    path: '/learn/session',
    scope: input.scope ?? 'persistence',
    event: name,
    ...(input.sessionId
      ? { sessionId: input.sessionId }
      : {}),
    ...(input.word ? { word: input.word } : {}),
    ...(input.index !== undefined
      ? { index: input.index }
      : {}),
    ...(input.queueLength !== undefined
      ? { queueLength: input.queueLength }
      : {}),
    ...(input.details
      ? { details: input.details }
      : {}),
  }
}

function trace(events: unknown[]) {
  return {
    schema: DEVELOPER_TRACE_SCHEMA,
    exportedAt: 2_000,
    events,
  }
}

function incident(
  events: unknown[],
  options: {
    resultVisible?: boolean
    typingWord?: string
    reviewRecords?: unknown[]
  } = {},
) {
  return {
    schema: DEVELOPER_INCIDENT_SCHEMA,
    capturedAt: 2_000,
    build: { commit: 'synthetic-build' },
    page: {
      href: 'https://example.invalid/learn/session',
      path: '/learn/session',
    },
    dom: {
      resultVisible: options.resultVisible ?? true,
      ...(options.typingWord
        ? {
            typingWord: {
              'data-typing-word': options.typingWord,
              'data-typing-active': 'false',
            },
          }
        : {}),
    },
    localStorage: {
      reviewModeInfo: {
        isReviewMode: true,
        reviewRecord: {
          id: 7,
          isFinished: true,
        },
      },
    },
    sessionStorage: {},
    trace: trace(events),
    database: {
      reviewRecords: options.reviewRecords ?? [],
    },
  }
}

test('loads trace and incident schemas while rejecting unknown schemas', () => {
  const parsedTrace = parseDiagnosticExport(
    trace([event(1, 'runtime-start')]),
  )
  assert.equal(parsedTrace.kind, 'trace')
  assert.equal(parsedTrace.events.length, 1)

  const parsedIncident = parseDiagnosticExport(
    incident([event(1, 'runtime-start')]),
  )
  assert.equal(parsedIncident.kind, 'incident')
  assert.equal(parsedIncident.buildCommit, 'synthetic-build')

  assert.throws(
    () =>
      parseDiagnosticExport({
        schema: 'future-schema-v99',
      }),
    DiagnosticReplayError,
  )
})

test('healthy terminal completion has no terminal divergence', () => {
  const report = replayDiagnostic(
    incident(
      [
        event(1, 'word-record-durable', {
          sessionId: '7',
          word: 'alpha',
          index: 0,
          queueLength: 1,
          scope: 'learn-terminal',
          details: { finalQueueItem: true },
        }),
        event(2, 'review-checkpoint-requested', {
          sessionId: '7',
          index: 0,
          queueLength: 1,
          details: { isFinished: true },
        }),
        event(3, 'ui-finish-dispatch', {
          sessionId: '7',
          word: 'alpha',
          index: 0,
          queueLength: 1,
          scope: 'learn-terminal',
        }),
        event(4, 'review-checkpoint-durable', {
          sessionId: '7',
          index: 0,
          queueLength: 1,
          details: { isFinished: true },
        }),
      ],
      { resultVisible: true },
    ),
  )

  assert.equal(
    report.anomalies.some(
      (item) => item.code === 'terminal-ui-divergence',
    ),
    false,
  )
  assert.equal(
    report.learnTrace.events.some(
      (item) => item.kind === 'terminal-ui-finished',
    ),
    true,
  )
})

test('incident snapshot detects terminal UI divergence structurally', () => {
  const report = replayDiagnostic(
    incident(
      [
        event(1, 'word-record-durable', {
          sessionId: '7',
          word: 'omega',
          index: 1,
          queueLength: 2,
          scope: 'learn-terminal',
          details: { finalQueueItem: true },
        }),
        event(2, 'review-checkpoint-requested', {
          sessionId: '7',
          index: 1,
          queueLength: 2,
          details: { isFinished: true },
        }),
        event(3, 'ui-finish-dispatch', {
          sessionId: '7',
          word: 'omega',
          index: 1,
          queueLength: 2,
          scope: 'learn-terminal',
        }),
        event(4, 'review-checkpoint-durable', {
          sessionId: '7',
          index: 1,
          queueLength: 2,
          details: { isFinished: true },
        }),
      ],
      {
        resultVisible: false,
        typingWord: 'omega',
      },
    ),
  )

  const found = report.anomalies.find(
    (item) => item.code === 'terminal-ui-divergence',
  )
  assert.ok(found)
  assert.equal(found.evidenceKind, 'mixed')
  assert.equal(found.sessionId, '7')
  assert.equal(found.word, 'omega')
})

test('finished checkpoint cannot regress or accept later Learn evidence', () => {
  const report = replayDiagnostic(
    trace([
      event(1, 'review-checkpoint-durable', {
        sessionId: '9',
        index: 1,
        queueLength: 2,
        details: { isFinished: true },
      }),
      event(2, 'review-checkpoint-requested', {
        sessionId: '9',
        index: 1,
        queueLength: 2,
        details: { isFinished: false },
      }),
      event(3, 'word-record-durable', {
        sessionId: '9',
        word: 'late',
        index: 1,
        queueLength: 2,
        scope: 'learn-terminal',
      }),
    ]),
  )

  assert.ok(
    report.anomalies.some(
      (item) =>
        item.code === 'finished-checkpoint-regression',
    ),
  )
  assert.ok(
    report.anomalies.some(
      (item) =>
        item.code ===
        'finished-session-evidence-after-terminal',
    ),
  )
})

test('active checkpoint index must stay inside its queue', () => {
  const report = replayDiagnostic(
    trace([
      event(1, 'review-checkpoint-requested', {
        sessionId: '10',
        index: 3,
        queueLength: 3,
        details: { isFinished: false },
      }),
    ]),
  )

  assert.ok(
    report.anomalies.some(
      (item) => item.code === 'invalid-session-index',
    ),
  )
})

test('pure Review >20 and mixed total >20 with <=20 acquisition are legal', () => {
  const words = Array.from({ length: 30 }, (_, index) => ({
    name: `word-${index}`,
  }))
  const legalMixedKinds = Object.fromEntries(
    words.map((word, index) => [
      word.name,
      index < 5 ? 'acquisition' : 'review',
    ]),
  )

  const report = replayDiagnostic(
    incident([], {
      reviewRecords: [
        {
          id: 1,
          sessionKind: 'review',
          isFinished: false,
          words,
        },
        {
          id: 2,
          sessionKind: 'mixed',
          isFinished: false,
          words,
          itemKinds: legalMixedKinds,
        },
      ],
    }),
  )

  assert.equal(
    report.anomalies.some(
      (item) =>
        item.code ===
        'oversized-acquisition-classification',
    ),
    false,
  )
})

test('explicit >20 acquisition cohort is detected', () => {
  const words = Array.from({ length: 21 }, (_, index) => ({
    name: `acq-${index}`,
  }))
  const report = replayDiagnostic(
    incident([], {
      reviewRecords: [
        {
          id: 3,
          sessionKind: 'acquisition',
          isFinished: false,
          words,
        },
      ],
    }),
  )

  assert.ok(
    report.anomalies.some(
      (item) =>
        item.code ===
        'oversized-acquisition-classification',
    ),
  )
})

test('audio owner violation requires explicit owner evidence', () => {
  const clean = replayDiagnostic(
    trace([
      event(1, 'audio-start', {
        word: 'alpha',
        scope: 'audio',
      }),
    ]),
  )
  assert.equal(
    clean.anomalies.some(
      (item) =>
        item.code === 'audio-owner-lifecycle-violation',
    ),
    false,
  )

  const bad = replayDiagnostic(
    trace([
      event(1, 'audio-start', {
        word: 'alpha',
        scope: 'audio',
        details: {
          audioOwnerKey: '4:0:beta',
        },
      }),
    ]),
  )
  assert.ok(
    bad.anomalies.some(
      (item) =>
        item.code === 'audio-owner-lifecycle-violation',
    ),
  )
})

test('ddmin preserves anomaly signature, order and deterministic result', () => {
  const source = incident(
    [
      event(1, 'noise-a'),
      event(2, 'review-checkpoint-durable', {
        sessionId: '7',
        index: 0,
        queueLength: 1,
        details: { isFinished: true },
      }),
      event(3, 'noise-b'),
      event(4, 'ui-finish-dispatch', {
        sessionId: '7',
        word: 'terminal',
        index: 0,
        queueLength: 1,
        scope: 'learn-terminal',
      }),
      event(5, 'noise-c'),
    ],
    {
      resultVisible: false,
      typingWord: 'terminal',
    },
  )
  const report = replayDiagnostic(source)
  const target = report.anomalies.find(
    (item) => item.code === 'terminal-ui-divergence',
  )
  assert.ok(target)

  const first = minimizeDiagnosticEvents(
    source,
    target.signature,
  )
  const second = minimizeDiagnosticEvents(
    source,
    target.signature,
  )

  assert.deepEqual(
    first.retainedSequences,
    second.retainedSequences,
  )
  assert.deepEqual(
    [...first.retainedSequences].sort((a, b) => a - b),
    first.retainedSequences,
  )
  assert.ok(first.minimizedEventCount < first.originalEventCount)
  const parsed = parseDiagnosticExport(source)
  assert.ok(
    replayDiagnostic({
      ...parsed,
      events: first.events,
    }).anomalies.some(
      (item) => item.signature === target.signature,
    ),
  )

  const replayable = createReplayableMinimizedExport(
    parsed,
    first,
  )
  const replayed = replayDiagnostic(replayable)
  assert.ok(
    replayed.anomalies.some(
      (item) => item.signature === target.signature,
    ),
  )
})

test('800-event trace minimization remains bounded and deterministic', () => {
  const events = Array.from({ length: 798 }, (_, index) =>
    event(index + 1, 'noise'),
  )
  events.push(
    event(799, 'review-checkpoint-durable', {
      sessionId: '800',
      index: 0,
      queueLength: 1,
      details: { isFinished: true },
    }),
  )
  events.push(
    event(800, 'ui-finish-dispatch', {
      sessionId: '800',
      word: 'terminal',
      index: 0,
      queueLength: 1,
      scope: 'learn-terminal',
    }),
  )
  const source = incident(events, {
    resultVisible: false,
    typingWord: 'terminal',
  })
  const report = replayDiagnostic(source)
  const target = report.anomalies.find(
    (item) => item.code === 'terminal-ui-divergence',
  )
  assert.ok(target)

  const started = Date.now()
  const minimized = minimizeDiagnosticEvents(
    source,
    target.signature,
  )
  const elapsed = Date.now() - started
  console.log(
    `P0 800-event diagnostic minimizer runtime: ${elapsed}ms`,
  )

  assert.ok(minimized.minimizedEventCount <= 2)
  assert.ok(elapsed < 5_000)
})
