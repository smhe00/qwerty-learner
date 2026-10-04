# Learn Formal × Simulation Bridge

> Status: active first-stage bridge.
>
> First live TLC gate:
>
> - TLA Gate: `37228957475`
> - result: PASS
>
> This phase begins after the frozen P4/P5 simulation checkpoint documented in
> `LEARN_SIMULATION_P4_P5_CHECKPOINT.md`.

## 1. Goal

Formal verification and simulation solve different parts of the Learn problem.

The bridge makes them exchange the same counterexample vocabulary:

```text
TLA+/TLC state-space exploration
            |
            v
      counterexample
            |
            v
      Shared Trace IR
            |
            +------------------+
            |                  |
            v                  v
     Generic Oracle    VirtualLearnApp replay
            |
            v
      regression corpus
```

The purpose is not to model the browser in TLA+.

TLA+ searches a deliberately small state abstraction. Simulation then checks
whether the discovered behavior corresponds to the production-backed controller
flow.

## 2. Shared Trace IR

`tests/simulation/trace-ir.ts` is the current versioned exchange format.

Current envelope:

```text
version = 1

source =
  simulation
  tlc-counterexample
  browser
  historical-replay
```

Current event vocabulary includes:

- session prepared;
- attempt completed;
- checkpoint save / restore;
- Acquisition health;
- waiting / deferred state.

The generic anomaly oracle consumes this IR regardless of where the trace came
from.

This keeps the oracle independent from:

- a particular mutation;
- TLC;
- the React driver;
- the historical bug that motivated the invariant.

## 3. Initial TLA+ abstraction

`formal/learn/LearnSystem.tla` is intentionally small.

The first model covers the daily Acquisition quota boundary that produced the
historical repeated-singleton failure.

State variables:

```text
phase
introduced
acquired
unseen
pending
sessionSize
singletonRun
```

Actions:

```text
StartAcquisition
DeferAcquisition
AdmitAcquisition
```

The initial invariant is:

```text
NoRepeatedSingleton ==
  singletonRun < 3
```

The abstraction does not model:

- characters;
- pronunciation;
- React rendering;
- IndexedDB;
- semantic word difficulty;
- months of learner memory.

Those remain simulation/integration concerns.

## 4. Two model configurations

### Production accounting

`LearnSystem.production.cfg`

Boundary seed:

```text
Target            = 20
InitialIntroduced = 19
InitialAcquired   = 19
InitialUnseen     = 11
QuotaAccounting   = introduced
```

TLC must prove the bounded model does not violate
`NoRepeatedSingleton`.

### Historical mutation

`LearnSystem.acquired-mutation.cfg`

The only semantic change is:

```text
QuotaAccounting = acquired
```

TLC is required to find a counterexample.

This makes the formal model useful as a mutation detector rather than merely a
specification that always passes.

## 5. TLC → Shared Trace bridge

`tests/formal/tla-trace-bridge.ts` parses ordinary TLC counterexample state
output.

A transition into:

```text
phase = acquisition
```

is projected into a Shared Trace `session-prepared` event.

For the admitted/acquired mutation, TLC produces repeated singleton acquisition
states. The converted trace is then evaluated by the same generic oracle used
by the simulator.

Expected anomaly:

```text
repeated-singleton-acquisition
```

The oracle is not told that the source trace came from the historical quota bug.

## 6. Live TLA Gate

`.github/workflows/tla-gate.yml` is separate from the ordinary Review Gate.

It runs only when formal/bridge assets change.

Current sequence:

```text
checkout
  ↓
Java + Node setup
  ↓
download integrity-pinned tla2tools.jar
  ↓
SANY parse
  ↓
TLC production config
  ↓
TLC acquired-based mutation
  ↓
require mutation failure / counterexample
  ↓
bundle counterexample checker
  ↓
TLC log → Shared Trace IR → Generic Oracle
```

The TLA+ tools artifact is verified before execution. A changed upstream binary
therefore fails the gate rather than being silently accepted.

## 7. First end-to-end proof

TLA Gate `37228957475` passed all bridge stages:

1. TLA syntax parsed successfully.
2. Production introduced-based quota model passed TLC.
3. Historical acquired-based quota model violated the invariant as required.
4. TLC emitted a concrete counterexample.
5. The TypeScript bridge parsed the live TLC output.
6. The counterexample became Shared Trace IR.
7. The existing system Oracle classified it as
   `repeated-singleton-acquisition`.

This is the first executable Formal × Simulation loop in Qwerty Plus.

## 8. Relationship to existing TypeScript formal checks

The repository already contains bounded exhaustive TypeScript model checks in
`tests/review/formal-model.test.ts`.

They remain useful because they execute production decision functions directly.

The intended division is:

### TypeScript bounded formal tests

Best for:

- exact production pure functions;
- totality;
- finite queue bounds;
- termination variants;
- rating-gate Cartesian products.

### TLA+/TLC

Best for:

- abstract cross-session state combinations;
- safety invariants;
- liveness;
- counterexample minimization;
- scheduler / pending / checkpoint protocol state spaces.

### Simulation

Best for:

- production orchestration;
- UI-driver divergence;
- virtual time;
- refresh/continue;
- user noise;
- longitudinal workload / retention;
- statistical anomaly detection.

These layers should exchange traces instead of duplicating implementations.

## 9. Next formal properties

Do not expand the model indiscriminately.

Recommended order:

### F1 — deferred readiness liveness

Abstract property:

```text
ready deferred word
  ~>
resumed OR explicitly excluded
```

Target bug class:

```text
stranded-pending-acquisition
```

### F2 — due-first safety

```text
due > 0
  =>
fresh Acquisition cannot start
```

Target oracle:

```text
due-work-bypassed
```

### F3 — checkpoint monotonicity

For the same logical session, a newer durable checkpoint must not be replaced by
an older semantic state.

Target oracle:

```text
checkpoint-regression
```

### F4 — progress liveness

A successful non-terminal attempt must eventually cause semantic progression or
enter an explicit bounded follow-up state.

Target oracles:

```text
success-without-progress
controller-driver-divergence
```

## 10. Counterexample promotion rule

A new TLC counterexample should follow this path:

```text
TLC counterexample
  ↓
Shared Trace
  ↓
Oracle classification
  ↓
production-backed replay
  ↓
confirmed?
  ├─ no  -> refine formal abstraction
  └─ yes -> fix production + permanent regression corpus
```

This prevents abstraction-only counterexamples from being mistaken for product
bugs.

## 11. Current boundary

No scheduler, quota, mastery or learner-policy parameter was changed while
building this bridge.

P4/P5 remains frozen at its green checkpoint.

The next work should extend formal properties one at a time, starting with
deferred/pending liveness, rather than returning immediately to broad random
mutation expansion.
