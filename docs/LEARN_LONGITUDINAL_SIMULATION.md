# Learn Longitudinal Learner Simulation

## Purpose

The simulation environment exists to test Learn as a **closed-loop learning system**, not only as a collection of isolated functions.

It supports:

- deterministic virtual time;
- heterogeneous learner personas;
- multi-day / multi-month progression;
- production scheduler and acquisition-quota logic;
- realistic Qwerty Plus record/state shapes;
- regression gates for workload, retention and backlog;
- offline policy sweeps before any production parameter change.

## What is simulated

### Virtual clock

The simulator advances an explicit Unix-time clock. A 120-day learning history can be executed in seconds without changing production time APIs.

No browser `Date.now()` monkey patch is required.

### Learner latent state

Each simulated word has hidden learner state:

- word difficulty;
- memory strength;
- last practice time;
- acquisition/admission status.

A learner persona controls:

- initial memory strength;
- forgetting rate;
- learning gain;
- relearning gain;
- lapse penalty;
- attention noise;
- typing-error probability;
- hint dependence;
- fatigue sensitivity;
- baseline response latency.

These latent values are **simulation-only**. Qwerty Plus never stores or labels a real learner with them.

### Current personas

The first baseline set contains:

- `strong-memory`
- `balanced`
- `weak-memory`
- `high-fatigue`

The purpose is not psychological classification. They are stress-test operating points for Learn control logic.

## Production logic reused

The simulator calls production logic for:

- `buildLearnStatsSnapshot()`
- `decideDailyAcquisitionQuota()`
- `scheduleBasicReview()`
- `countLongTermMasteredWords()`

It also generates production-shaped:

- `IWordRecord`
- `IReviewWordState`

This is intentionally different from the smaller control-theory virtual learner in `tests/review/control-stability.test.ts`, which operates on an abstract scalar memory model.

## Due-first invariant

If due-review backlog remains after the simulated learner reaches the day's review capacity, Acquisition is blocked.

This mirrors the product invariant:

```text
due review > pending/fresh acquisition
```

The simulator must not create a false performance result by violating Learn's own service priority.

## Policy injection

Production defaults remain unchanged, but two production functions accept optional policy objects:

- `scheduleBasicReview(input, schedulePolicy?)`
- `decideDailyAcquisitionQuota(stats, quotaPolicy?)`

Normal product code does not pass overrides.

The simulation harness can therefore test candidate policies using the same production implementation rather than copying scheduler/quota algorithms.

## Policy sweep

`tests/simulation/policy-sweep.ts` defines an initial three-candidate sweep:

- `baseline`
- `retention-first`
- `load-first`

The current synthetic objective combines:

- 30-day retention proxy;
- long-term mastery rate;
- lapse rate;
- average daily interaction load;
- due backlog.

The objective weights are **provisional** and must not be treated as product truth.

## CI gates

Review Gate runs:

1. short-horizon domain tests;
2. formal model tests;
3. control-stability tests;
4. longitudinal learner simulation;
5. policy-sweep invariants;
6. browser/build/smoke gates.

This means a scheduler or Learn-control change can be rejected even if its local unit test passes but it creates a multi-month workload or retention pathology.

## Current limitations

The V1 simulator is intentionally incomplete.

It does not yet model:

- missed study days / vacations;
- variable session time budgets;
- school-week vs weekend behavior;
- vocabulary semantic similarity/interference;
- pronunciation-specific memory;
- phrase-length effects;
- per-letter spelling difficulty;
- sleep/consolidation effects;
- real user abandonment;
- real-world motivational effects;
- FSRS as the active production owner.

The acquisition path is modeled at a higher abstraction than the full UI state machine. It emits valid phased-acquisition evidence and admission states, but it does not replay every visual interaction event.

## Calibration requirement

Synthetic simulation is useful for:

- discovering logical instability;
- comparing parameter directions;
- finding workload explosions;
- testing safety envelopes;
- generating realistic-shaped records for downstream analytics.

It is **not sufficient** for final parameter tuning.

Before production tuning, persona distributions should be calibrated from anonymized real Qwerty Plus traces using observed quantities such as:

- first cold-probe pass rate;
- lapse probability by review interval;
- latency distribution;
- hint-use rate;
- acquisition attempts per admitted word;
- review success by interval;
- daily active-session size;
- missed-day distribution;
- recovery after failure.

Recommended calibration flow:

```text
real traces
   ↓
fit persona / difficulty distributions
   ↓
hold-out validation against unseen real traces
   ↓
policy sweep
   ↓
robust candidate selection across personas
   ↓
production experiment
```

## Parameter tuning rule

A simulator result may propose a candidate but must not silently modify production policy.

Production changes should require:

1. simulation improvement across multiple personas/seeds;
2. no formal/control regression;
3. bounded workload/backlog;
4. calibration against real traces;
5. an explicit code review of the policy delta.

This keeps the simulator as a decision-support system rather than an unchecked optimizer.
