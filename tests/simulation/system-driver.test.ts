import assert from 'node:assert/strict'
import test from 'node:test'
import type { Word } from '../../src/typings'
import { VirtualLearnApp } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'

function word(name: string): Word {
  return {
    name,
    trans: [name],
    usphone: '',
    ukphone: '',
  }
}

async function finishAllAcquisitionWork(
  app: VirtualLearnApp,
  maxCycles = 30,
) {
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    let progressed = false
    while (app.completeCurrentAcquisitionClean()) {
      progressed = true
    }

    app.exit()
    const next = await app.enter()
    if (
      next.kind === 'waiting' &&
      next.reason === 'deferred' &&
      next.diagnostics.nextResumeAt !== undefined
    ) {
      app.advanceSeconds(
        next.diagnostics.nextResumeAt - app.now + 1,
      )
      app.exit()
      await app.enter()
      continue
    }

    if (
      next.kind === 'session' &&
      next.record.sessionKind === 'acquisition'
    ) {
      continue
    }

    return { progressed, result: next }
  }

  throw new Error('acquisition lifecycle did not converge')
}

test('VirtualLearnApp survives enter, progress, refresh, time travel and Continue without anomalies', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 8 },
      (_, index) => word(`w${index}`),
    ),
  })

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  if (first.kind !== 'session') return
  assert.equal(first.record.sessionKind, 'acquisition')
  assert.equal(first.source, 'acquisition')

  assert.equal(app.completeCurrentAcquisitionClean(), true)
  assert.equal(app.completeCurrentAcquisitionClean(), true)

  const beforeRefresh = app.snapshot()
  const latestBeforeRefresh = beforeRefresh.sessions
    .filter((session) => !session.isFinished)
    .at(-1)
  assert.ok(latestBeforeRefresh)

  const restored = await app.refresh()
  assert.equal(restored.kind, 'session')
  if (restored.kind !== 'session') return
  assert.equal(restored.source, 'restored')
  assert.equal(restored.record.id, latestBeforeRefresh.id)
  assert.equal(restored.record.index, latestBeforeRefresh.index)

  const settled = await finishAllAcquisitionWork(app)
  assert.ok(settled.progressed || app.wordStates.length > 0)
  assert.ok(app.wordStates.length > 0)

  const preDayAnomalies =
    detectLearnSystemAnomalies(app.events)
  assert.deepEqual(preDayAnomalies, [])

  app.exit()
  app.advanceDays(1)
  const nextDay = await app.enter()
  assert.equal(nextDay.kind, 'session')
  if (nextDay.kind !== 'session') return
  assert.equal(nextDay.record.sessionKind, 'review')

  let reviewSteps = 0
  while (app.completeCurrentReviewClean()) {
    reviewSteps += 1
    assert.ok(reviewSteps < 100)
  }
  assert.ok(reviewSteps > 0)

  app.exit()
  app.advanceDays(3)
  const later = await app.enter()
  assert.equal(later.kind, 'session')
  if (later.kind !== 'session') return
  assert.equal(later.record.sessionKind, 'review')

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.deepEqual(anomalies, [])
})

test('the same lifecycle script exposes a dropped UI projection through the generic oracle', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 8 },
      (_, index) => word(`m${index}`),
    ),
    mutation: {
      dropProjectionAtInteraction: 3,
    },
  })

  const first = await app.enter()
  assert.equal(first.kind, 'session')

  for (let index = 0; index < 8; index += 1) {
    if (!app.completeCurrentAcquisitionClean()) break
  }

  const anomalies = detectLearnSystemAnomalies(app.events)
  const divergence = anomalies.find(
    (item) => item.code === 'controller-driver-divergence',
  )

  assert.ok(divergence)
  assert.equal(divergence.severity, 'high')
})

test('refresh restores the latest persisted checkpoint rather than restarting the session', async () => {
  const app = new VirtualLearnApp({
    words: ['a', 'b', 'c', 'd', 'e', 'f'].map(word),
  })

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  assert.equal(app.completeCurrentAcquisitionClean(), true)
  assert.equal(app.completeCurrentAcquisitionClean(), true)
  assert.equal(app.completeCurrentAcquisitionClean(), true)

  const before = app.snapshot()
  const checkpoint = before.sessions
    .filter((session) => !session.isFinished)
    .at(-1)
  assert.ok(checkpoint)

  const restored = await app.refresh()
  assert.equal(restored.kind, 'session')
  if (restored.kind !== 'session') return

  assert.equal(restored.record.id, checkpoint.id)
  assert.equal(restored.record.index, checkpoint.index)
  assert.deepEqual(
    restored.record.words.map((item) => item.name),
    checkpoint.words.map((item) => item.name),
  )

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.equal(
    anomalies.some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})


async function runHistoricalFinalSlotScenario(
  quotaAccounting: 'production' | 'acquired',
) {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 30 },
      (_, index) => word(`h${index}`),
    ),
    mutation: {
      quotaAccounting,
    },
  })
  app.seedAdmittedWords(19)

  for (let cycle = 0; cycle < 6; cycle += 1) {
    const prepared = await app.enter()
    if (
      prepared.kind !== 'session' ||
      prepared.record.sessionKind !== 'acquisition'
    ) {
      break
    }

    let interactions = 0
    while (app.completeCurrentAcquisitionClean()) {
      interactions += 1
      assert.ok(interactions < 20)
    }
    app.exit()
  }

  return {
    app,
    anomalies: detectLearnSystemAnomalies(app.events),
  }
}

test('full VirtualLearnApp remains stable at the historical 19-of-20 acquisition boundary', async () => {
  const result =
    await runHistoricalFinalSlotScenario('production')

  assert.equal(
    result.anomalies.some(
      (item) =>
        item.code === 'repeated-singleton-acquisition',
    ),
    false,
  )

  const acquisitionSessions = result.app.events.filter(
    (event) =>
      event.kind === 'session-prepared' &&
      event.sessionKind === 'acquisition',
  )
  assert.equal(acquisitionSessions.length, 1)
})

test('full VirtualLearnApp blindly rediscovers the admitted-based singleton loop mutation', async () => {
  const result =
    await runHistoricalFinalSlotScenario('acquired')

  const singleton = result.anomalies.find(
    (item) =>
      item.code === 'repeated-singleton-acquisition',
  )
  assert.ok(singleton)

  const acquisitionSessions = result.app.events.filter(
    (event) =>
      event.kind === 'session-prepared' &&
      event.sessionKind === 'acquisition',
  )
  assert.ok(acquisitionSessions.length >= 3)
  assert.ok(
    acquisitionSessions.slice(0, 3).every(
      (event) =>
        event.kind === 'session-prepared' &&
        event.batchSize === 1,
    ),
  )
})


test('full VirtualLearnApp detects stale checkpoint restoration after refresh', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 8 },
      (_, index) => word(`s${index}`),
    ),
    mutation: {
      staleRestoreOnce: true,
    },
  })

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  assert.equal(app.completeCurrentAcquisitionClean(), true)

  app.seedStaleCheckpointFromActive()

  assert.equal(app.completeCurrentAcquisitionClean(), true)

  const restored = await app.refresh()
  assert.equal(restored.kind, 'session')
  if (restored.kind !== 'session') return
  assert.equal(restored.source, 'restored')

  const anomalies = detectLearnSystemAnomalies(app.events)
  const regression = anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.severity, 'high')
})


test('full VirtualLearnApp keeps due Review ahead of fresh Acquisition', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 12 },
      (_, index) => word(`d${index}`),
    ),
  })
  app.seedAdmittedWords(3)
  app.makeSeededWordsDue(3)

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') return
  assert.equal(prepared.record.sessionKind, 'review')

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.equal(
    anomalies.some(
      (item) => item.code === 'due-work-bypassed',
    ),
    false,
  )
})

test('full VirtualLearnApp blindly detects a due-first bypass mutation', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 12 },
      (_, index) => word(`x${index}`),
    ),
    mutation: {
      bypassDueFirst: true,
    },
  })
  app.seedAdmittedWords(3)
  app.makeSeededWordsDue(3)

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') return
  assert.equal(prepared.record.sessionKind, 'acquisition')

  const anomalies = detectLearnSystemAnomalies(app.events)
  const bypass = anomalies.find(
    (item) => item.code === 'due-work-bypassed',
  )
  assert.ok(bypass)
  assert.equal(bypass.severity, 'high')
})


test('ready deferred Acquisition is resumed by production candidate planning', async () => {
  const app = new VirtualLearnApp({
    words: [word('deferred-production')],
  })
  app.seedDeferredAcquisition({
    reason: 'assistance',
    ready: true,
  })

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') return
  assert.equal(prepared.source, 'acquisition')
  assert.equal(prepared.record.sessionKind, 'acquisition')
  assert.equal(
    prepared.record.acquisitionStates?.[
      'deferred-production'
    ]?.phase,
    'supported',
  )

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.equal(
    anomalies.some(
      (item) =>
        item.code === 'stranded-pending-acquisition',
    ),
    false,
  )
})

test('production-backed simulation detects a ready deferred candidate hidden from planning', async () => {
  const app = new VirtualLearnApp({
    words: [word('deferred-stranded')],
    mutation: {
      strandReadyDeferred: true,
    },
  })
  app.seedDeferredAcquisition({
    reason: 'assistance',
    ready: true,
  })

  const first = await app.enter()
  assert.equal(first.kind, 'waiting')

  app.exit()
  const second = await app.enter()
  assert.equal(second.kind, 'waiting')

  const anomalies = detectLearnSystemAnomalies(app.events)
  const stranded = anomalies.find(
    (item) =>
      item.code === 'stranded-pending-acquisition',
  )
  assert.ok(stranded)
  assert.equal(stranded.severity, 'high')
  assert.equal(
    stranded.details.missedOpportunities,
    2,
  )
})


async function runDuePendingPriorityScenario(input: {
  quotaExhausted: boolean
  bypassDueFirst: boolean
}) {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 30 },
      (_, index) => word(`f2-${index}`),
    ),
    mutation: input.bypassDueFirst
      ? { bypassDueFirst: true }
      : undefined,
  })

  const admitted = input.quotaExhausted ? 20 : 3
  app.seedAdmittedWords(admitted)
  app.makeSeededWordsDue(Math.min(3, admitted))
  app.seedDeferredAcquisition({
    wordIndex: admitted,
    reason: 'assistance',
    ready: true,
  })

  const prepared = await app.enter()
  return {
    app,
    prepared,
    anomalies: detectLearnSystemAnomalies(app.events),
  }
}

test('F2 production keeps due Review ahead of ready pending and fresh work while quota remains', async () => {
  const result = await runDuePendingPriorityScenario({
    quotaExhausted: false,
    bypassDueFirst: false,
  })

  assert.equal(result.prepared.kind, 'session')
  if (result.prepared.kind !== 'session') return
  assert.equal(result.prepared.record.sessionKind, 'review')
  assert.equal(
    result.anomalies.some(
      (item) => item.code === 'due-work-bypassed',
    ),
    false,
  )
})

test('F2 production keeps due Review ahead of ready pending even after fresh quota is exhausted', async () => {
  const result = await runDuePendingPriorityScenario({
    quotaExhausted: true,
    bypassDueFirst: false,
  })

  assert.equal(result.prepared.kind, 'session')
  if (result.prepared.kind !== 'session') return
  assert.equal(result.prepared.record.sessionKind, 'review')
  assert.equal(
    result.anomalies.some(
      (item) => item.code === 'due-work-bypassed',
    ),
    false,
  )
})

test('F2 simulation blindly detects pending/fresh Acquisition bypassing due Review', async () => {
  for (const quotaExhausted of [false, true]) {
    const result = await runDuePendingPriorityScenario({
      quotaExhausted,
      bypassDueFirst: true,
    })

    assert.equal(result.prepared.kind, 'session')
    if (result.prepared.kind !== 'session') continue
    assert.equal(
      result.prepared.record.sessionKind,
      'acquisition',
    )

    const bypass = result.anomalies.find(
      (item) => item.code === 'due-work-bypassed',
    )
    assert.ok(bypass)
    assert.equal(bypass.severity, 'high')
    assert.ok(Number(bypass.details.dueCount) > 0)
  }
})


test('F3 production Review refresh restores the latest durable checkpoint', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 6 },
      (_, index) => word(`f3-review-${index}`),
    ),
  })
  app.seedAdmittedWords(4)
  app.makeSeededWordsDue(4)

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  if (first.kind !== 'session') return
  assert.equal(first.record.sessionKind, 'review')

  assert.equal(app.completeCurrentReviewClean(), true)
  assert.equal(app.completeCurrentReviewClean(), true)

  const before = app.snapshot()
  const latest = before.sessions
    .filter((session) => !session.isFinished)
    .at(-1)
  assert.ok(latest)

  const restored = await app.refresh()
  assert.equal(restored.kind, 'session')
  if (restored.kind !== 'session') return
  assert.equal(restored.source, 'restored')
  assert.equal(restored.record.id, latest.id)
  assert.equal(restored.record.index, latest.index)

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.equal(
    anomalies.some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})

test('F3 Review stale checkpoint mutation is detected after later progress', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 6 },
      (_, index) => word(`f3-stale-${index}`),
    ),
    mutation: {
      staleRestoreOnce: true,
    },
  })
  app.seedAdmittedWords(4)
  app.makeSeededWordsDue(4)

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  if (first.kind !== 'session') return
  assert.equal(first.record.sessionKind, 'review')

  assert.equal(app.completeCurrentReviewClean(), true)
  app.seedStaleCheckpointFromActive()
  assert.equal(app.completeCurrentReviewClean(), true)

  const restored = await app.refresh()
  assert.equal(restored.kind, 'session')
  if (restored.kind !== 'session') return
  assert.equal(restored.source, 'restored')

  const anomalies = detectLearnSystemAnomalies(app.events)
  const regression = anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.severity, 'high')
})


async function runTerminalCheckpointScenario(staleRestoreOnce: boolean) {
  const app = new VirtualLearnApp({
    words: [word('f3-terminal')],
    mutation: staleRestoreOnce
      ? { staleRestoreOnce: true }
      : undefined,
  })

  app.seedAdmittedWords(1)
  app.makeSeededWordsDue(1)

  const first = await app.enter()
  assert.equal(first.kind, 'session')
  if (first.kind !== 'session') {
    return {
      app,
      restored: first,
      anomalies: detectLearnSystemAnomalies(app.events),
    }
  }
  assert.equal(first.record.sessionKind, 'review')

  app.seedStaleCheckpointFromActive()

  assert.equal(app.completeCurrentReviewClean(), true)
  const durable = app.snapshot().sessions.find(
    (session) => session.id === first.record.id,
  )
  assert.ok(durable)
  assert.equal(durable.isFinished, true)

  const restored = await app.refresh()
  return {
    app,
    restored,
    anomalies: detectLearnSystemAnomalies(app.events),
  }
}

test('F3 production never resurrects a finished checkpoint after refresh', async () => {
  const result = await runTerminalCheckpointScenario(false)

  assert.notEqual(
    result.restored.kind === 'session'
      ? result.restored.source
      : 'waiting',
    'restored',
  )
  assert.equal(
    result.anomalies.some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})

test('F3 simulation blindly detects terminal stale checkpoint resurrection', async () => {
  const result = await runTerminalCheckpointScenario(true)

  assert.equal(result.restored.kind, 'session')
  if (result.restored.kind !== 'session') return
  assert.equal(result.restored.source, 'restored')
  assert.equal(result.restored.record.isFinished, false)

  const regression = result.anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.severity, 'high')
  assert.equal(regression.details.savedFinished, true)
  assert.equal(regression.details.restoredFinished, false)
})


test('F4 production Review success always advances, finishes, or changes item state', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 5 },
      (_, index) => word(`f4-review-${index}`),
    ),
  })
  app.seedAdmittedWords(3)
  app.makeSeededWordsDue(3)

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') return
  assert.equal(prepared.record.sessionKind, 'review')

  assert.equal(app.completeCurrentReviewClean(), true)

  const anomalies = detectLearnSystemAnomalies(app.events)
  assert.equal(
    anomalies.some(
      (item) => item.code === 'success-without-progress',
    ),
    false,
  )
})

test('F4 production Acquisition success can stay on the same index when item state progresses', async () => {
  const app = new VirtualLearnApp({
    words: [word('f4-acquisition')],
  })

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  if (prepared.kind !== 'session') return
  assert.equal(prepared.record.sessionKind, 'acquisition')

  assert.equal(app.completeCurrentAcquisitionClean(), true)

  const attempt = app.events.find(
    (event) =>
      event.kind === 'attempt-completed' &&
      event.word === 'f4-acquisition',
  )
  assert.ok(attempt)
  if (attempt.kind !== 'attempt-completed') return
  assert.notEqual(
    attempt.beforeItemStateSignature,
    attempt.afterItemStateSignature,
  )

  assert.equal(
    detectLearnSystemAnomalies(app.events).some(
      (item) => item.code === 'success-without-progress',
    ),
    false,
  )
})

test('F4 simulation detects a successful Review attempt that silently commits no semantic progress', async () => {
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 5 },
      (_, index) => word(`f4-stuck-review-${index}`),
    ),
    mutation: {
      silentNoopAtInteraction: 1,
    },
  })
  app.seedAdmittedWords(3)
  app.makeSeededWordsDue(3)

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  assert.equal(app.completeCurrentReviewClean(), true)

  const anomalies = detectLearnSystemAnomalies(app.events)
  const stuck = anomalies.find(
    (item) => item.code === 'success-without-progress',
  )
  assert.ok(stuck)
  assert.equal(stuck.severity, 'high')
  assert.equal(stuck.details.sessionKind, 'review')
})

test('F4 simulation detects a successful Acquisition attempt with neither projection nor item-state progress', async () => {
  const app = new VirtualLearnApp({
    words: [word('f4-stuck-acquisition')],
    mutation: {
      silentNoopAtInteraction: 1,
    },
  })

  const prepared = await app.enter()
  assert.equal(prepared.kind, 'session')
  assert.equal(app.completeCurrentAcquisitionClean(), true)

  const anomalies = detectLearnSystemAnomalies(app.events)
  const stuck = anomalies.find(
    (item) => item.code === 'success-without-progress',
  )
  assert.ok(stuck)
  assert.equal(stuck.severity, 'high')
  assert.equal(stuck.details.sessionKind, 'acquisition')
})
