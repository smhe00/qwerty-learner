import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectLearnSystemAnomalies,
} from '../simulation/system-oracle'
import {
  parseTlcCounterexample,
  tlcStatesToLearnTrace,
} from './tla-trace-bridge'

const acquiredMutationCounterexample = `
Error: Invariant NoRepeatedSingleton is violated.
State 1: <Initial predicate>
/\\ phase = "idle"
/\\ introduced = 19
/\\ acquired = 19
/\\ unseen = 11
/\\ pending = 0
/\\ sessionSize = 0
/\\ singletonRun = 0

State 2: <StartAcquisition line 45, col 1 to line 57, col 20 of module LearnSystem>
/\\ phase = "acquisition"
/\\ introduced = 19
/\\ acquired = 19
/\\ unseen = 11
/\\ pending = 0
/\\ sessionSize = 1
/\\ singletonRun = 1

State 3: <DeferAcquisition line 59, col 1 to line 67, col 31 of module LearnSystem>
/\\ phase = "idle"
/\\ introduced = 20
/\\ acquired = 19
/\\ unseen = 10
/\\ pending = 1
/\\ sessionSize = 0
/\\ singletonRun = 1

State 4: <StartAcquisition line 45, col 1 to line 57, col 20 of module LearnSystem>
/\\ phase = "acquisition"
/\\ introduced = 20
/\\ acquired = 19
/\\ unseen = 10
/\\ pending = 1
/\\ sessionSize = 1
/\\ singletonRun = 2

State 5: <DeferAcquisition line 59, col 1 to line 67, col 31 of module LearnSystem>
/\\ phase = "idle"
/\\ introduced = 21
/\\ acquired = 19
/\\ unseen = 9
/\\ pending = 2
/\\ sessionSize = 0
/\\ singletonRun = 2

State 6: <StartAcquisition line 45, col 1 to line 57, col 20 of module LearnSystem>
/\\ phase = "acquisition"
/\\ introduced = 21
/\\ acquired = 19
/\\ unseen = 9
/\\ pending = 2
/\\ sessionSize = 1
/\\ singletonRun = 3
`

const productionTrace = `
State 1: <Initial predicate>
/\\ phase = "idle"
/\\ introduced = 19
/\\ acquired = 19
/\\ unseen = 11
/\\ pending = 0
/\\ sessionSize = 0
/\\ singletonRun = 0

State 2: <StartAcquisition line 45, col 1 to line 57, col 20 of module LearnSystem>
/\\ phase = "acquisition"
/\\ introduced = 19
/\\ acquired = 19
/\\ unseen = 11
/\\ pending = 0
/\\ sessionSize = 1
/\\ singletonRun = 1

State 3: <DeferAcquisition line 59, col 1 to line 67, col 31 of module LearnSystem>
/\\ phase = "idle"
/\\ introduced = 20
/\\ acquired = 19
/\\ unseen = 10
/\\ pending = 1
/\\ sessionSize = 0
/\\ singletonRun = 1
`

test('TLC counterexample parser extracts bounded Learn states', () => {
  const states = parseTlcCounterexample(
    acquiredMutationCounterexample,
  )

  assert.equal(states.length, 6)
  assert.equal(states[1].values.phase, 'acquisition')
  assert.equal(states[1].values.sessionSize, 1)
  assert.equal(states[5].values.singletonRun, 3)
})

test('TLC singleton counterexample maps into Shared Trace IR and is classified by the existing generic oracle', () => {
  const states = parseTlcCounterexample(
    acquiredMutationCounterexample,
  )
  const trace = tlcStatesToLearnTrace(
    states,
    'admitted-based-quota',
  )

  assert.equal(trace.version, 1)
  assert.equal(trace.source, 'tlc-counterexample')
  assert.equal(trace.events.length, 3)

  const anomalies = detectLearnSystemAnomalies(trace.events)
  const singleton = anomalies.find(
    (item) =>
      item.code === 'repeated-singleton-acquisition',
  )
  assert.ok(singleton)
  assert.equal(singleton.severity, 'high')
})

test('production introduced-based bounded trace does not create a false singleton alarm', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(productionTrace),
    'introduced-based-quota',
  )

  assert.equal(trace.events.length, 1)
  assert.deepEqual(
    detectLearnSystemAnomalies(trace.events),
    [],
  )
})


const strandedDeferredCounterexample = `
Error: Temporal properties were violated.

State 1: <Initial predicate>
/\\ phase = "deferred"
/\\ clock = 0
/\\ resumeAfter = 1

State 2: <Tick line 15, col 1 to line 19, col 40 of module DeferredLifecycle>
/\\ phase = "deferred"
/\\ clock = 1
/\\ resumeAfter = 1

State 3: Stuttering
`

const resumedDeferredTrace = `
State 1: <Initial predicate>
/\\ phase = "deferred"
/\\ clock = 0
/\\ resumeAfter = 1

State 2: <Tick line 15, col 1 to line 19, col 40 of module DeferredLifecycle>
/\\ phase = "deferred"
/\\ clock = 1
/\\ resumeAfter = 1

State 3: <ResumeDeferred line 21, col 1 to line 26, col 40 of module DeferredLifecycle>
/\\ phase = "resumed"
/\\ clock = 1
/\\ resumeAfter = 1
`

test('TLC stuttering liveness counterexample maps to ready-deferred starvation', () => {
  const states = parseTlcCounterexample(
    strandedDeferredCounterexample,
  )
  assert.equal(states.length, 3)
  assert.equal(states[2]?.action, 'Stuttering')
  assert.equal(states[2]?.values.phase, 'deferred')

  const trace = tlcStatesToLearnTrace(
    states,
    'stranded-deferred',
  )
  const anomalies = detectLearnSystemAnomalies(trace.events)

  assert.ok(
    anomalies.some(
      (item) =>
        item.code === 'stranded-pending-acquisition',
    ),
  )
})

test('resumed deferred trace clears the liveness concern without a false alarm', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(resumedDeferredTrace),
    'resumed-deferred',
  )

  assert.equal(
    detectLearnSystemAnomalies(trace.events).some(
      (item) =>
        item.code === 'stranded-pending-acquisition',
    ),
    false,
  )
})
