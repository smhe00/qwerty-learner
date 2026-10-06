---
protocol_version: "1.1"
task_id: "TASK-20261006-003-production-aligned-learn-sim"
title: "P1 production-aligned Learn simulator and replay-seed bridge"
status: "IN_PROGRESS"
target_branch: "product/main"
base_commit: "18092df71e490bdccbe63c61b987d04a42de16b5"
recommended_executor: "high-reasoning-compatible-agent"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-003-production-aligned-learn-sim-report.md"
release_to_master: false
---

# TASK-20261006-003 — P1 Production-Aligned Learn Simulator

## Objective

Upgrade the Learn simulation so it exercises the same session semantics and lifecycle hazards as production rather than relying on compatibility-only driver paths.

P1 must close the refinement gap exposed during recent field-debugging:

- production uses unified mixed Review + Acquisition sessions;
- the simulator still contains old review/acquisition compatibility flows;
- browser lifecycle actions such as reload/route restoration were not first-class simulation actions;
- P0 can now minimize real incidents, but minimized traces are not yet reusable as deterministic simulation seeds.

Target loop:

```text
production Learn semantics
        ↓
production-aligned VirtualLearnApp
        ↓
stateful lifecycle actions
        ↓
oracles / anomalies
        ↑
P0 minimized incident seed
```

## Scope

### In scope

1. Move shared Learn Trace IR out of `tests/` into a neutral source module and update all consumers.
2. Make `VirtualLearnApp` prepare sessions through the current unified mixed-session semantics.
3. Preserve compatibility helpers only where explicitly needed for historical replay tests; do not use them as the primary virtual-product path.
4. Model lifecycle actions:
   - reload/restore;
   - route leave/re-enter;
   - checkpoint interruption/stale persistence arrival;
   - background/foreground where it affects state ownership;
   - terminal completion followed by reload/restore.
5. Add a deterministic adapter from P0 normalized/minimized traces into simulation lifecycle seeds/actions.
6. Add oracles/invariants for:
   - terminal state immutability;
   - no evidence after finished session;
   - finished checkpoint monotonicity;
   - route/restore may not resurrect a finished session;
   - mixed item ownership remains correct;
   - cohort size counts Acquisition logical words, not Review volume;
   - occurrence identity cannot overwrite logical-word state.
7. Extend the stateful explorer to include lifecycle actions and report reproducible failing seeds.
8. Extend mutation sensitivity to prove the new lifecycle invariants can actually kill injected faults.
9. Integrate P1 into Review Gate without touching `master`.

### Out of scope

- no Learn UI redesign;
- no new scheduler/FSRS policy;
- no release to `master`;
- no EdgeOne build;
- no cloud upload of diagnostics;
- no real user incident data committed to fixtures.

## Key Principle

The simulator is not considered useful merely because clean production logic passes.

For every new invariant P1 introduces, add at least one injected fault/mutation or deliberately broken test model that the simulator/oracle must detect.

## Acceptance Criteria

- [ ] Shared Trace IR no longer lives under `tests/` as the canonical definition.
- [ ] VirtualLearnApp primary session path supports `review | acquisition | mixed` using current production semantics.
- [ ] Mixed session item ownership is represented per logical word.
- [ ] Reload/restore is a first-class deterministic simulation action.
- [ ] Finished sessions cannot be restored as active.
- [ ] Post-finish evidence is detected as an anomaly.
- [ ] Finished checkpoint regression is detected.
- [ ] Pure Review volume >20 is legal.
- [ ] Mixed total >20 with Acquisition <=20 is legal.
- [ ] >20 Acquisition logical words is rejected/detected.
- [ ] P0 minimized trace can be converted to deterministic simulation actions without hand editing.
- [ ] At least one synthetic P0 minimized trace becomes a permanent P1 regression seed.
- [ ] Lifecycle explorer emits a reproducible seed/action sequence on failure.
- [ ] Mutation scorecard covers route resurrection, stale checkpoint, post-finish evidence, and wrong mixed ownership.
- [ ] Existing Review/Formal/TLA/Browser/Build gates remain green.
- [ ] No real user diagnostic artifact is committed.
- [ ] Report explains remaining model-vs-production gaps.

## Validation

At minimum:

- targeted P1 unit tests;
- system oracle tests;
- system driver/explorer tests;
- mutation scorecard;
- persistence-race tests;
- P0 field replay tests;
- TLA trace bridge tests;
- full Review Gate.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
real_user_incident_commit: forbidden
```
