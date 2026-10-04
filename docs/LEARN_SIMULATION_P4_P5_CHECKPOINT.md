# Learn Simulation P4/P5 Checkpoint

> Status: frozen pause point on `product/main`.
>
> Green baseline:
>
> - commit: `c874a2a5dae1cee6c7ea54cbc4310f6beb4b62a5`
> - Review Gate: `37228252565`
> - result: PASS
>
> This document marks the point where P4/P5 system-level simulation work can
> pause without losing a clean, reproducible baseline.

## 1. Scope completed

P4/P5 established a Learn-system verification layer above ordinary unit tests.

The key architectural rule is:

```text
Production Learn controller
        |
        +---- React/UI driver
        |
        +---- VirtualLearnApp / simulation driver
```

The simulator does not maintain an independent copy of Learn orchestration.

Shared production paths currently include:

- session preparation:
  - bootstrap
  - unfinished-session restore
  - due Review
  - quota / daily plan
  - Acquisition selection
  - deferred wait / resume timing
- Acquisition item progression
- Review item progression
- scheduler transitions
- Acquisition candidate planning

## 2. Virtual system driver

`tests/simulation/system-driver.ts` provides an event-level virtual application
capable of:

- entering Learn;
- completing Review or Acquisition attempts;
- producing Good / Hard / Again outcomes;
- exiting and continuing;
- refreshing and restoring checkpoints;
- advancing virtual time by seconds or days;
- starting from fresh, warm or due-bearing learner state;
- seeding historical admitted state;
- observing pending/deferred Acquisition state.

It records behavioral traces rather than only final statistics.

## 3. Generic anomaly oracle

`tests/simulation/system-oracle.ts` detects behavior classes without knowing
which mutation produced them.

Current anomaly vocabulary:

```text
repeated-singleton-acquisition
success-without-progress
controller-driver-divergence
checkpoint-regression
due-work-bypassed
stranded-pending-acquisition
```

The oracle operates on observable system traces and is intentionally separated
from mutation definitions.

## 4. Historical / system bug corpus

### BUG-001 — repeated singleton Acquisition

Historical boundary:

```text
19 / 20 daily acquisition boundary
```

Production accounting remains stable.

A mutation that restores acquired/admitted-based quota accounting is blindly
rediscovered from the resulting repeated session shape:

```text
1 -> 1 -> 1 -> ...
```

The oracle reports:

```text
repeated-singleton-acquisition
```

### BUG-002 — successful attempt does not progress

A dropped UI projection can leave a successful word with the wrong live cursor
or queue.

The simulation compares the production controller projection with the driver's
actual state and reports:

```text
controller-driver-divergence
```

A true no-op successful completion can also report:

```text
success-without-progress
```

### BUG-003 — stale checkpoint resurrection

The virtual app can inject restoration of an older persisted checkpoint after a
newer checkpoint exists.

The oracle detects rollback / terminal resurrection / stale exact matches as:

```text
checkpoint-regression
```

### BUG-004 — due-first bypass

A mutation can bypass due Review admission and force Acquisition while due work
exists.

The oracle reports:

```text
due-work-bypassed
```

### BUG-005 — deferred / pending Acquisition recovery

The current production path supports resumable deferred Acquisition, including
spacing and assistance-related deferral.

The verification layer now observes generic deferred resume timing rather than
only one historical spacing case.

Pending deferred state with no future resume path is reported as:

```text
stranded-pending-acquisition
```

## 5. Blind random exploration

`tests/simulation/system-explorer.test.ts` performs deterministic random user
action exploration.

Current clean exploration covers:

- profiles:
  - fresh
  - warm
  - due
- 18 deterministic seeds;
- 220 user/system steps per seed;
- total clean exploratory steps: 3,960.

Actions include:

- successful / Hard / Again attempts;
- refresh;
- exit / re-enter;
- short and long virtual-time advances;
- day jumps.

The clean production controller must remain anomaly-free.

Mutation campaigns also place failures at positions unknown to the oracle.

Current campaigns include:

- dropped projection at randomized interaction positions;
- due-first bypass with randomized user behavior.

## 6. Mutation scorecard

The current generic scorecard includes independent failure classes:

1. repeated singleton selection;
2. dropped controller projection;
3. stale checkpoint rollback;
4. due Review bypass.

At the checkpoint baseline:

```text
known scorecard mutations detected = 4 / 4
clean controls with false positive = 0
```

This is not yet a claim of general 100% bug-detection sensitivity. It only
describes the current bounded mutation corpus.

## 7. Longitudinal layer remains available

The earlier longitudinal learner simulator remains part of Review Gate and can
still run:

- virtual time;
- heterogeneous learner personas;
- production scheduler;
- production quota;
- policy sweeps;
- trace-signature calibration.

P4/P5 intentionally pauses expansion of random personas / mutations here. The
next priority is to connect the system trace to formal state-space exploration.

## 8. Pause rule

P4/P5 is considered paused, not complete forever.

Resume P4/P5 when one of the following occurs:

- a new real user bug produces a new failure class;
- formal checking produces a counterexample that simulation cannot replay;
- mutation kill-rate exposes an important blind spot;
- a production controller change adds a new state/action vocabulary.

Do not continue adding random mutations only to increase mutation count.

## 9. Next phase

The next phase is Formal × Simulation integration:

```text
Shared Trace IR
      |
      +---- Simulation trace
      |
      +---- TLA+/TLC counterexample
      |
      v
Trace replay
      |
      v
Generic Oracle
      |
      v
Regression corpus
```

Initial goals:

1. define a versioned Shared Trace IR;
2. create a small TLA+ Learn abstraction;
3. convert TLC counterexample states into Shared Trace events;
4. replay the counterexample against the production-backed simulation driver;
5. promote confirmed counterexamples into the permanent bug corpus.

## 10. Change-control boundary

The green checkpoint above is the reference baseline.

Formal-bridge work must not silently alter scheduler or Learn policy parameters.

Any production behavior change discovered through the bridge still requires:

- a production-controller fix;
- a regression trace;
- Review Gate;
- browser/build gates where applicable.
