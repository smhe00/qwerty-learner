import assert from 'node:assert/strict'
import test from 'node:test'
import { createSerializedSnapshotWriter } from '../../src/review/persistence'
import type { LearnSystemTraceEvent } from './trace-ir'
import { detectLearnSystemAnomalies } from './system-oracle'

type Snapshot = {
  sessionId: string
  sequence: number
  index: number
  isFinished: boolean
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function signature(snapshot: Snapshot): string {
  return [
    snapshot.index,
    snapshot.isFinished ? 1 : 0,
  ].join(':')
}

function requestEvent(snapshot: Snapshot): LearnSystemTraceEvent {
  return {
    kind: 'persistence-write',
    action: 'requested',
    sessionId: snapshot.sessionId,
    sequence: snapshot.sequence,
    semanticSignature: signature(snapshot),
  }
}

function commitEvent(snapshot: Snapshot): LearnSystemTraceEvent {
  return {
    kind: 'persistence-write',
    action: 'committed',
    sessionId: snapshot.sessionId,
    sequence: snapshot.sequence,
    semanticSignature: signature(snapshot),
  }
}

function createControlledPersistence(
  events: LearnSystemTraceEvent[],
) {
  const gates = new Map<number, Deferred>()
  const started: number[] = []
  let durable: Snapshot | undefined

  return {
    gates,
    started,
    durable: () => durable,
    persist: async (snapshot: Snapshot) => {
      started.push(snapshot.sequence)
      const gate = deferred()
      gates.set(snapshot.sequence, gate)
      await gate.promise
      durable = structuredClone(snapshot)
      events.push(commitEvent(snapshot))
    },
  }
}

test('serialized production writer preserves request order under adversarial completion timing', async () => {
  const events: LearnSystemTraceEvent[] = []
  const controlled = createControlledPersistence(events)
  const writer = createSerializedSnapshotWriter(
    controlled.persist,
  )

  const first: Snapshot = {
    sessionId: 'review:1',
    sequence: 1,
    index: 0,
    isFinished: false,
  }
  const second: Snapshot = {
    sessionId: 'review:1',
    sequence: 2,
    index: 1,
    isFinished: true,
  }

  events.push(requestEvent(first))
  const firstWrite = writer.enqueue(first)
  events.push(requestEvent(second))
  const secondWrite = writer.enqueue(second)

  await Promise.resolve()
  assert.deepEqual(controlled.started, [1])
  assert.equal(controlled.gates.has(2), false)

  controlled.gates.get(1)?.resolve()
  await firstWrite
  await Promise.resolve()

  assert.deepEqual(controlled.started, [1, 2])
  controlled.gates.get(2)?.resolve()
  await secondWrite

  assert.equal(controlled.durable()?.sequence, 2)
  assert.equal(controlled.durable()?.isFinished, true)
  assert.deepEqual(
    detectLearnSystemAnomalies(events),
    [],
  )
})

test('serialized writer freezes an immutable snapshot at enqueue time', async () => {
  const events: LearnSystemTraceEvent[] = []
  const controlled = createControlledPersistence(events)
  const writer = createSerializedSnapshotWriter(
    controlled.persist,
  )

  const source: Snapshot = {
    sessionId: 'review:immutable',
    sequence: 1,
    index: 0,
    isFinished: false,
  }
  events.push(requestEvent(source))
  const write = writer.enqueue(source)
  source.index = 99
  source.isFinished = true

  await Promise.resolve()
  controlled.gates.get(1)?.resolve()
  await write

  assert.equal(controlled.durable()?.index, 0)
  assert.equal(controlled.durable()?.isFinished, false)
})

test('serialized writer continues with newer work after an earlier persistence failure', async () => {
  const started: number[] = []
  const writer = createSerializedSnapshotWriter<Snapshot>(
    async (snapshot) => {
      started.push(snapshot.sequence)
      if (snapshot.sequence === 1) {
        throw new Error('injected write failure')
      }
    },
  )

  const first = writer.enqueue({
    sessionId: 'review:failure',
    sequence: 1,
    index: 0,
    isFinished: false,
  })
  const second = writer.enqueue({
    sessionId: 'review:failure',
    sequence: 2,
    index: 1,
    isFinished: false,
  })

  await assert.rejects(first, /injected write failure/)
  await second
  assert.deepEqual(started, [1, 2])
})

test('unordered persistence mutation is detected when an older checkpoint commits last', async () => {
  const events: LearnSystemTraceEvent[] = []
  const controlled = createControlledPersistence(events)

  const first: Snapshot = {
    sessionId: 'review:race',
    sequence: 1,
    index: 0,
    isFinished: false,
  }
  const second: Snapshot = {
    sessionId: 'review:race',
    sequence: 2,
    index: 1,
    isFinished: true,
  }

  events.push(requestEvent(first))
  const firstWrite = controlled.persist(first)
  events.push(requestEvent(second))
  const secondWrite = controlled.persist(second)

  assert.deepEqual(controlled.started, [1, 2])

  controlled.gates.get(2)?.resolve()
  await secondWrite
  controlled.gates.get(1)?.resolve()
  await firstWrite

  assert.equal(controlled.durable()?.sequence, 1)
  assert.equal(controlled.durable()?.isFinished, false)

  const violation = detectLearnSystemAnomalies(
    events,
  ).find(
    (item) =>
      item.code === 'persistence-order-violation',
  )
  assert.ok(violation)
  assert.equal(violation.severity, 'high')
  assert.equal(violation.details.sequence, 1)
  assert.equal(violation.details.lastCommitted, 2)
})
