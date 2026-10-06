---
protocol_version: "1.1"
task_id: "TASK-20261006-004-mutation-coverage-review"
status: "REVIEW"
executor: "chat"
target_branch: "product/main"
accepted_candidate_head: "ebee13b26c8523316723a01190e3072e2947d3fc"
release_to_master: false
---

# TASK-20261006-004 — P2 Mutation 2.0 + Coverage Review 3.0

## Status

**REVIEW**

Implementation and mandatory validation are complete. No P2 commit has been released to `master`.

## Branch state

```text
product/main = ebee13b26c8523316723a01190e3072e2947d3fc
master       = 26e8454f519850374aaf9f3fd61c67c9a7222638
```

The divergence is intentional.

## Implementation commits

- `22950159` — start/claim P2 task
- `059dee11` — align fresh-budget oracle with explicit production planner baseline
- `c1ad073c` — versioned critical fault catalog + mutation coverage contract
- `4b88189a` — classify legacy mixed/cohort fault classes
- `abea8e84` — add workload soft-budget mutation
- `ebee13b2` — align FreshBudget TLA model and TLA→Trace evidence with mixed-session policy

## Mutation 2.0 result

From Review Gate `37418640947`:

```text
catalogVersion       1
catalogTotal         42
covered              38
partial               4
uncovered             0

executableCritical   29
detected             29
criticalKillRate     1.0

cleanControls        11
falsePositives        0
```

All executable critical catalog entries are required to have a scorecard case.

The CI threshold is encoded in `P2_MUTATION_POLICY`:

- minimum executable critical faults: 18
- required critical kill rate: 100%
- maximum clean false positives: 0

## Expanded executable fault classes

P2 now kills faults across:

- terminal handoff / terminal immutability;
- checkpoint rollback / resurrection;
- persistence request/commit ordering;
- mixed item ownership;
- occurrence vs logical-state identity;
- candidate lifecycle;
- fresh/pending/quota/workload budget;
- session arbitration;
- deferred acquisition liveness;
- stale audio owner and success-audio lifecycle;
- controller/projection progress.

The scorecard grew from P1's 11 executable classes to **29**.

## Verification-system bugs found by P2

### Fresh-budget oracle refinement gap

The oracle did not have enough evidence to distinguish raw quota capacity from production workload-planner allowance and mixed-session pending capacity.

Fix: explicit expected baseline fields are now carried in Trace IR.

### Formal FreshBudget model refinement gap

`FreshBudget.tla` still encoded the retired hard rule:

```text
due == true => allowedNow == 0
```

This contradicted the current mixed-session product policy.

Fix:

- FreshBudget formal model now handles quota/accounting independently of Review priority;
- DuePriority remains the priority model;
- TLA bridge emits expected budget evidence to the shared oracle.

This was not a product bug; it was a **verification model bug** that could have produced misleading confidence.

## Validation

### Review Gate

```text
run 37418640947
SUCCESS
```

Passed:

- lint
- Review/domain/acquisition regressions
- formal model bridge
- P0 diagnostic CLI
- Learn control stability
- async ownership
- longitudinal simulation
- Mutation 2.0
- P0 field replay
- Typing audio formal
- FSRS shadow/G3
- Typing browser lifecycle
- build
- production navigation smoke
- multi-word Learn/Review browser gate

### Standalone TLA Gate

```text
run 37418640835
SUCCESS
```

Production models and intended mutation counterexamples passed, including the corrected F8 FreshBudget trace replay.

### Stateful explorer

```text
60 seeds × 220 steps
clean failures = 0

drop-projection mutation: 12/12 detected
due-first bypass mutation: 8/8 detected
```

### P0 regression

```text
800-event minimizer runtime in CI = 3 ms
```

## Coverage Review 3.0

Full matrix:

```text
docs/COVERAGE_REVIEW_3.md
```

Detector-layer reach:

- simulation: 34 catalog entries
- formal: 21
- browser: 15
- P0 replay: 9
- domain: 4

## Explicit partial gaps

P2 intentionally leaves four catalog entries as `partial`:

1. stale async preparation wins navigation;
2. route-cache vs IndexedDB divergence after a real process crash window;
3. refresh during checkpoint commit timing window;
4. viewport resize as an independent virtual action.

These are P3 targets. They are **not** counted as killed mutations and are not hidden behind the 100% mutation number.

## Acceptance criteria

- [x] versioned critical fault catalog
- [x] id/family/severity/detector/status for every catalog entry
- [x] per-fault mutation scorecard
- [x] CI critical kill threshold
- [x] CI false-positive threshold
- [x] baseline expanded from 11 to 29 executable critical mutations
- [x] >18 executable/formal critical fault classes
- [x] lifecycle/persistence expansion
- [x] mixed-session/identity expansion
- [x] async/browser ownership mapping
- [x] Coverage Review 3.0 detector matrix
- [x] blind spots explicitly classified
- [x] Review Gate green
- [x] standalone TLA Gate green
- [x] no real user diagnostic committed
- [x] master untouched

## Reviewer focus

1. Do not interpret 29/29 as universal product coverage.
2. Confirm the 4 partial classes remain visible in the catalog/report.
3. Confirm FreshBudget formal semantics now match mixed-session policy.
4. Confirm catalog additions automatically increase the CI denominator when `executableMutation=true`.
5. Confirm P2 remains verification infrastructure, not a Learn policy change.

## Recommended next phase

P3: browser stateful fuzzing focused on the four partial lifecycle/timing classes.
