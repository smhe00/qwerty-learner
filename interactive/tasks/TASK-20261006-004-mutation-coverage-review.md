---
protocol_version: "1.1"
task_id: "TASK-20261006-004-mutation-coverage-review"
title: "P2 Mutation 2.0 and Coverage Review 3.0"
status: "IN_PROGRESS"
target_branch: "product/main"
base_commit: "0e636324a992c4c5b2a0964952db0024f7408d1c"
recommended_executor: "high-reasoning-compatible-agent"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-004-mutation-coverage-review-report.md"
release_to_master: false
---

# TASK-20261006-004 — P2 Mutation 2.0 + Coverage Review 3.0

## Objective

Turn the current simulation/formal/browser stack into an explicit fault-detection system with measurable critical-fault coverage.

P2 must answer:

> Which realistic Learn/Typing lifecycle faults can the current verification stack detect, which layer detects them, and which important classes remain blind?

The goal is not only more tests. The goal is a **coverage contract**:

```text
critical fault catalog
        ↓
fault injection / mutant
        ↓
expected detector layer
        ↓
anomaly / failing invariant
        ↓
CI threshold
        ↓
coverage review report
```

## Scope

### In scope

1. Define a versioned critical fault catalog.
2. Expand mutation classes beyond the current 11 classes.
3. Add mutation classes derived from recent field incidents and known lifecycle hazards.
4. Track which detector layer kills each mutation:
   - domain/simulation oracle;
   - formal/TLA;
   - browser lifecycle;
   - P0 replay.
5. Enforce CI thresholds for critical mutations.
6. Add clean-control false-positive threshold.
7. Add deterministic mutation campaign output suitable for Coverage Review.
8. Audit model-vs-production gaps and classify:
   - covered;
   - partially covered;
   - uncovered;
   - intentionally out of scope.
9. Fix verification blind spots found during P2 where practical.
10. Keep all work on `product/main`.

### Out of scope

- no new product feature;
- no scheduler policy tuning;
- no master release;
- no EdgeOne deploy;
- no real user diagnostic artifact in Git.

## Initial critical fault families

At minimum cover or explicitly disposition:

### Terminal / persistence
- terminal route resurrection;
- post-finish evidence write;
- finished checkpoint regression;
- terminal UI handoff stall;
- stale checkpoint restore;
- duplicate terminal completion;
- finished session selected as recoverable.

### Mixed-session ownership / identity
- missing itemKinds with acquisition state;
- wrong Review/Acquisition ownership;
- occurrence identity collapsed into logical state;
- duplicate logical state for repeated occurrence;
- acquisition cohort counted from total queue instead of acquisition logical words;
- pure Review >20 wrongly rotated.

### Candidate / quota / admission
- due priority broken;
- pending counted as fresh;
- admitted word re-enters Acquisition;
- excluded word selected;
- duplicate canonical selection;
- fresh over budget;
- pending consumes fresh budget;
- unseen cap ignored;
- introduced/acquired accounting confusion.

### Async ownership / browser lifecycle
- stale audio owner completion;
- audio requested before ready then lost;
- cleanup callback stops new owner;
- route/resize reload resurrects terminal state;
- stale async preparation wins navigation;
- blur/focus resets statistics;
- refresh during checkpoint.

### Persistence ordering / data integrity
- commit before request;
- out-of-order durable checkpoint;
- stale write overwrites newer snapshot;
- route cache and IndexedDB disagree after reload.

## Acceptance Criteria

- [ ] Versioned critical fault catalog exists in source/tests.
- [ ] Every critical fault has an id, family, severity, detector expectation and status.
- [ ] Mutation scorecard reports per-fault detection, detector layer and false positives.
- [ ] Critical mutation threshold is enforced in CI.
- [ ] Clean-control false-positive threshold is enforced.
- [ ] Current 11/11 baseline is preserved or superseded by a larger passing catalog.
- [ ] At least 18 critical fault classes are executable or formally represented.
- [ ] At least 4 fault classes are lifecycle/persistence faults not present in original 7-class scorecard.
- [ ] At least 3 mixed-session/identity faults are represented.
- [ ] At least 3 async/browser ownership faults are represented across simulation/formal/browser layers.
- [ ] A Coverage Review 3.0 report maps each fault to detector layers.
- [ ] Blind spots are stated explicitly; no false 100% claim across unmodeled classes.
- [ ] Full Review Gate remains green.
- [ ] Standalone TLA Gate remains green where formal files are touched.
- [ ] No real user incident data committed.
- [ ] No master release.

## CI Policy

Define thresholds as code/constants, not prose-only.

Recommended initial gate:

```text
critical executable mutations killed = 100%
clean false positives = 0
coverage catalog disposition = 100% classified
```

A fault catalog entry may be `uncovered` only if:
- the report names the gap;
- the reason is explicit;
- it does not count as an executable critical mutation in the kill-rate denominator.

## Deliverables

- fault catalog;
- expanded mutation scorecard;
- detector-layer mapping;
- CI thresholds;
- Coverage Review 3.0 report;
- execution report;
- commit SHAs and validation results.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
real_user_incident_commit: forbidden
```
