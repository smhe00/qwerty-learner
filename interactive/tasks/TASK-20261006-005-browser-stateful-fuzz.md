---
protocol_version: "1.1"
task_id: "TASK-20261006-005-browser-stateful-fuzz"
title: "P3 browser stateful lifecycle fuzzing"
status: "IN_PROGRESS"
target_branch: "product/main"
base_commit: "0652eb63a7e74267d1251b1c45c0b4205b96c48b"
recommended_executor: "high-reasoning-compatible-agent"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-005-browser-stateful-fuzz-report.md"
release_to_master: false
---

# TASK-20261006-005 — P3 Browser Stateful Fuzzing

## Objective

Close the four lifecycle/timing gaps left partial by Coverage Review 3.0 using deterministic Playwright stateful fuzzing with replayable seeds and bounded failure minimization.

Targets:

1. stale async preparation wins navigation;
2. route-cache / IndexedDB divergence around crash/reload windows;
3. refresh during checkpoint commit;
4. viewport resize as an independent browser action.

The test system must emulate real React/router/browser behavior rather than only VirtualLearnApp abstractions.

## Required capabilities

- deterministic seeded browser action generator;
- action log emitted on every failure;
- exact seed replay;
- bounded action-sequence minimizer for failing browser seeds;
- lifecycle actions including:
  - type correct / type wrong;
  - space / escape / backspace;
  - route leave / Learn re-enter;
  - reload;
  - viewport resize desktop→desktop;
  - blur/focus or equivalent browser visibility lifecycle;
  - controlled persistence delay/failure window where supported by test hooks;
  - controlled async Learn preparation delay/race;
- invariants checked continuously:
  - finished session never returns to active word UI;
  - no Learn evidence after terminal;
  - durable checkpoint never regresses;
  - current route and persisted ownership agree;
  - no stale preparation may steal navigation ownership;
  - resize alone must not navigate;
  - statistics/progress survive blur/focus/reload according to durability boundary.

## Testability hooks

Prefer narrow, test-only deterministic hooks over arbitrary sleeps.

Hooks must:
- be inactive in normal production;
- not change product semantics;
- be explicit and documented;
- allow browser tests to delay/release selected async persistence/preparation operations.

## Acceptance criteria

- [ ] deterministic seeded browser fuzzer exists;
- [ ] exact seed/action replay is supported;
- [ ] failures report seed + ordered action trace;
- [ ] failing action traces can be greedily/ddmin reduced;
- [ ] at least 20 clean deterministic seeds execute bounded multi-action lifecycle runs;
- [ ] stale preparation/navigation mutation is detected;
- [ ] refresh-during-checkpoint mutation is detected;
- [ ] terminal resize resurrection mutation is detected;
- [ ] route-cache/DB disagreement is detected or explicitly diagnosed through a controlled browser fault;
- [ ] clean seeds have zero invariant failures;
- [ ] P2 fault catalog updates the four partial entries according to measured P3 coverage;
- [ ] full Review Gate remains green;
- [ ] no real user incident data committed;
- [ ] no master release.

## CI policy

P3 browser fuzz must be bounded for normal Review Gate runtime.

Use:
- a small deterministic seed set in required CI;
- an expanded local/nightly-compatible set documented separately;
- no probabilistic pass/fail.

## Git / Release

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
```
