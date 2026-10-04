import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectLearnSystemAnomalies,
  type LearnSystemTraceEvent,
} from './system-oracle'

type Checkpoint = {
  sessionId: string
  index: number
  isFinished: boolean
  queueSignature: string
  wordCount: number
}

function event(
  action: 'save' | 'restore',
  checkpoint: Checkpoint,
): LearnSystemTraceEvent {
  return {
    kind: 'checkpoint',
    action,
    ...checkpoint,
  }
}

test('checkpoint oracle accepts monotonic restore of the latest persisted state', () => {
  const latest: Checkpoint = {
    sessionId: 'learn-1',
    index: 4,
    isFinished: false,
    queueSignature: 'a|b|c|d|e',
    wordCount: 5,
  }

  const anomalies = detectLearnSystemAnomalies([
    event('save', latest),
    event('restore', latest),
  ])

  assert.equal(
    anomalies.some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})

test('checkpoint oracle blindly detects stale-write rollback mutation', () => {
  const latest: Checkpoint = {
    sessionId: 'learn-1',
    index: 4,
    isFinished: false,
    queueSignature: 'a|b|c|d|e',
    wordCount: 5,
  }
  const stale: Checkpoint = {
    sessionId: 'learn-1',
    index: 2,
    isFinished: false,
    queueSignature: 'a|b|c|d|e',
    wordCount: 5,
  }

  // The mutation represents an old asynchronous write winning after the newer
  // checkpoint. The oracle is only shown the observable save/restore trace.
  const anomalies = detectLearnSystemAnomalies([
    event('save', latest),
    event('restore', stale),
  ])

  const regression = anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.severity, 'high')
})

test('checkpoint oracle detects terminal resurrection while allowing lifecycle pruning', () => {
  const finished: Checkpoint = {
    sessionId: 'learn-2',
    index: 4,
    isFinished: true,
    queueSignature: 'a|b|c|d|e',
    wordCount: 5,
  }
  const resurrected: Checkpoint = {
    ...finished,
    index: 3,
    isFinished: false,
  }

  const prunedSave: Checkpoint = {
    sessionId: 'learn-3',
    index: 2,
    isFinished: false,
    queueSignature: 'a|b|c|d',
    wordCount: 4,
  }
  const prunedRestore: Checkpoint = {
    sessionId: 'learn-3',
    index: 1,
    isFinished: false,
    queueSignature: 'a|c|d',
    wordCount: 3,
  }

  const resurrection = detectLearnSystemAnomalies([
    event('save', finished),
    event('restore', resurrected),
  ])
  assert.ok(
    resurrection.some(
      (item) => item.code === 'checkpoint-regression',
    ),
  )

  const pruning = detectLearnSystemAnomalies([
    event('save', prunedSave),
    event('restore', prunedRestore),
  ])
  assert.equal(
    pruning.some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})
