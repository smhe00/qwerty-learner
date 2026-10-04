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
      next.reason === 'spacing' &&
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
