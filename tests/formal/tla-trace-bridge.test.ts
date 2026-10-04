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


const dueFirstBypassCounterexample = `
Error: Invariant NoAcquisitionWhenDue is violated.

State 1: <Initial predicate>
/\\ phase = "idle"
/\\ due = 1
/\\ pendingReady = 1
/\\ unseen = 2
/\\ quota = 2
/\\ sessionSize = 0
/\\ acquisitionKind = "none"

State 2: <StartPendingAcquisition line 36, col 1 to line 43, col 57 of module DuePriority>
/\\ phase = "acquisition"
/\\ due = 1
/\\ pendingReady = 1
/\\ unseen = 2
/\\ quota = 2
/\\ sessionSize = 1
/\\ acquisitionKind = "pending"
`

const dueFirstProductionTrace = `
State 1: <Initial predicate>
/\\ phase = "idle"
/\\ due = 1
/\\ pendingReady = 1
/\\ unseen = 2
/\\ quota = 2
/\\ sessionSize = 0
/\\ acquisitionKind = "none"

State 2: <StartReview line 27, col 1 to line 34, col 57 of module DuePriority>
/\\ phase = "review"
/\\ due = 1
/\\ pendingReady = 1
/\\ unseen = 2
/\\ quota = 2
/\\ sessionSize = 1
/\\ acquisitionKind = "none"
`

test('TLC due-first bypass maps to due-work-bypassed without mutation-specific bridge logic', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(dueFirstBypassCounterexample),
    'due-first-bypass',
  )

  const anomalies = detectLearnSystemAnomalies(trace.events)
  const bypass = anomalies.find(
    (item) => item.code === 'due-work-bypassed',
  )

  assert.ok(bypass)
  assert.equal(bypass.severity, 'high')
  assert.equal(bypass.details.dueCount, 1)
})

test('TLC due-first production trace does not create a false acquisition-priority alarm', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(dueFirstProductionTrace),
    'due-first-production',
  )

  assert.equal(
    detectLearnSystemAnomalies(trace.events).some(
      (item) => item.code === 'due-work-bypassed',
    ),
    false,
  )
})


const staleCheckpointCounterexample = `
Error: Invariant RestoreLatestCheckpoint is violated.

State 1: <Initial predicate>
/\\ phase = "active"
/\\ durableVersion = 0
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 2: <SaveProgress line 24, col 1 to line 35, col 30 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 3: <Refresh line 50, col 1 to line 67, col 34 of module CheckpointMonotonicity>
/\\ phase = "restored"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE
`

const latestCheckpointProductionTrace = `
State 1: <Initial predicate>
/\\ phase = "active"
/\\ durableVersion = 0
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 2: <SaveProgress line 24, col 1 to line 35, col 30 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 3: <Refresh line 50, col 1 to line 67, col 34 of module CheckpointMonotonicity>
/\\ phase = "restored"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 1
/\\ restoredFinished = FALSE
`

test('TLC stale checkpoint restore maps to checkpoint-regression', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(staleCheckpointCounterexample),
    'stale-checkpoint-restore',
  )

  const anomalies = detectLearnSystemAnomalies(trace.events)
  const regression = anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )

  assert.ok(regression)
  assert.equal(regression.severity, 'high')
  assert.equal(regression.details.savedIndex, 1)
  assert.equal(regression.details.restoredIndex, 0)
})

test('TLC production checkpoint restore maps cleanly through the shared oracle', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(latestCheckpointProductionTrace),
    'latest-checkpoint-restore',
  )

  assert.equal(
    detectLearnSystemAnomalies(trace.events).some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})


const checkpointRollbackCounterexample = `
Error: Invariant RestoreLatestCheckpoint is violated.

State 1: <Initial predicate>
/\\ phase = "active"
/\\ durableVersion = 0
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 2: <SaveProgress line 27, col 1 to line 40, col 32 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 3: <Refresh line 55, col 1 to line 72, col 27 of module CheckpointMonotonicity>
/\\ phase = "restored"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE
`

const checkpointProductionTrace = `
State 1: <Initial predicate>
/\\ phase = "active"
/\\ durableVersion = 0
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 2: <SaveProgress line 27, col 1 to line 40, col 32 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 3: <Refresh line 55, col 1 to line 72, col 27 of module CheckpointMonotonicity>
/\\ phase = "restored"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 1
/\\ restoredFinished = FALSE
`

const checkpointTerminalResurrection = `
State 1: <Initial predicate>
/\\ phase = "active"
/\\ durableVersion = 0
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 2: <SaveProgress line 27, col 1 to line 40, col 32 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 1
/\\ durableFinished = FALSE
/\\ staleVersion = 0
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 3: <SaveTerminal line 42, col 1 to line 53, col 32 of module CheckpointMonotonicity>
/\\ phase = "active"
/\\ durableVersion = 2
/\\ durableFinished = TRUE
/\\ staleVersion = 1
/\\ staleFinished = FALSE
/\\ restoredVersion = 0
/\\ restoredFinished = FALSE

State 4: <Refresh line 55, col 1 to line 72, col 27 of module CheckpointMonotonicity>
/\\ phase = "restored"
/\\ durableVersion = 2
/\\ durableFinished = TRUE
/\\ staleVersion = 1
/\\ staleFinished = FALSE
/\\ restoredVersion = 1
/\\ restoredFinished = FALSE
`

test('TLC stale checkpoint rollback maps to checkpoint-regression', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(checkpointRollbackCounterexample),
    'checkpoint-rollback',
  )

  const anomalies = detectLearnSystemAnomalies(trace.events)
  const regression = anomalies.find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.severity, 'high')
})

test('TLC production checkpoint restore does not create a false regression', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(checkpointProductionTrace),
    'checkpoint-production',
  )

  assert.equal(
    detectLearnSystemAnomalies(trace.events).some(
      (item) => item.code === 'checkpoint-regression',
    ),
    false,
  )
})

test('TLC terminal checkpoint resurrection is classified by the same oracle', () => {
  const trace = tlcStatesToLearnTrace(
    parseTlcCounterexample(checkpointTerminalResurrection),
    'checkpoint-terminal-resurrection',
  )

  const regression = detectLearnSystemAnomalies(trace.events).find(
    (item) => item.code === 'checkpoint-regression',
  )
  assert.ok(regression)
  assert.equal(regression.details.savedFinished, true)
  assert.equal(regression.details.restoredFinished, false)
})
