# Verification Architecture and Gate Manifest

> Status: **canonical verification governance**

Qwerty Plus entered this refactor with 81 test files and 13 workflows. The
current tree has more test files because giant mixed-responsibility suites were
split by owner before duplicate assertions are deleted. File count is therefore
not a success metric; contract coverage, ownership, Gate runtime, and protected
regression count are.

The governance triangle is:

- product specification: `docs/SPECIFICATION_V1.md`;
- executable ownership: `tests/verification/gate-manifest.json`;
- protected real-world regressions:
  `tests/verification/regression-catalog.json`.

The lightweight **Verification Contract Gate** validates all three with
`scripts/validate-gate-manifest.mjs`.

## Verification levels

### L0 — Product Contract

Stable product semantics. These should change only when the product decision
changes.

Examples:

- DailySession is the user-visible Learn session.
- Daily progress advances only after final independent-clean completion.
- Reload never reopens an already completed logical word.
- Post-success pronunciation is forbidden.
- Safe auto-sync never overwrites remote-ahead/diverged state.

### L1 — Domain / Formal / Simulation

State-machine and scheduler properties:

- acquisition phases;
- hint progression;
- FSRS scheduler;
- quota accounting;
- checkpoint monotonicity;
- candidate/session arbitration;
- mutation and counterexample coverage;
- Cloud Sync V2 distributed protocol refinement across local progress, Block/manual sync, multi-device state, backup/restore, deletion, crash, and account lifecycle.

### L2 — Integration / Browser

Real browser behavior across React, IndexedDB, routing, localStorage, audio, and
reload boundaries.

### L3 — Regression

Minimal reproductions of real defects. Regression coverage should remain even
when higher-level suites are reorganized.

## Gate ownership rule

Each specialized concern has one canonical gate owner. A broad integration gate
may exercise the same runtime indirectly, but should not rerun the same
specialized test binaries.

Current canonical ownership:

| Concern | Canonical gate |
| --- | --- |
| Static dependency direction / layer boundaries | Architecture Gate |
| Specification / contract / regression traceability | Verification Contract Gate |
| Learn / Review integration | Review Gate |
| FSRS package + active scheduler contracts | FSRS Phase G Gate |
| FSRS 365-day / multi-seed strategy benchmark | FSRS Benchmark Gate |
| Learn TLC models / counterexamples | TLA Gate |
| Cloud Sync V2 end-to-end executable protocol | Sync TLA Gate |
| Achievement rules | Achievement Gate |
| Dictionary content | Dictionary Gate |
| Cloud backend/sync | Cloud Sync workflows |

## Change rule

A behavior-changing commit must update its contract verification in the same
change.

Accepted no-test cases are limited to changes such as formatting, comments,
mechanical rename, or a provably behavior-neutral refactor already covered by
the same contract suite.

A failing old test must be classified before editing:

1. **real regression** — fix production code;
2. **stale semantic expectation** — update the contract and test together;
3. **duplicate coverage** — remove from the non-owner gate;
4. **legacy-only** — retain with an explicit sunset reason or delete once the
   compatibility path is gone.

## Cleanup sequence

### P0 — Governance and obvious duplication — complete

- Architecture V2 established;
- Product Specification V1 established;
- machine-readable Contract → Spec → Test → Gate traceability added;
- regression catalog validator added;
- duplicated FSRS G2/G3/G5 execution removed from Review Gate;
- docs-only edits removed from heavyweight behavior Gates;
- stale runs are cancelled through workflow concurrency.

### P1 — Split oversized suites — complete

The old mixed browser suite is now divided into:

- `learn-review-flow.spec.ts`
- `learn-acquisition-flow.spec.ts`
- `learn-recovery-flow.spec.ts`
- `learn-shell-ui.spec.ts`
- `learn-legacy-compat.spec.ts`

The old 101-case `tests/review/domain.test.ts` no longer exists. Domain
coverage is owned by Hint, Evidence, Audio, Exercise-policy,
Scheduler/Lifecycle, Acquisition, Scaffold/Recovery, and Quota/Strain suites.

### P2 — Regression inventory and deduplication — in progress

- protected historical regression IDs are machine-validated;
- obsolete Basic-v1 migration code/tests have been removed;
- Basic-v2 is retained only as a shadow/comparator model;
- residual Review foundation coverage is being consolidated by owner;
- deletion is allowed only after equivalent canonical coverage is proven.

### P3 — Workflow retirement — substantially complete

The legacy Node 18/npm/full-suite `.github/workflows/e2e.yml` has been
retired. Product/main behavior is verified by owned Gates, while master release
verification remains with EdgeOne production/browser verification workflows.

## Success criteria

The refactor is complete when:

- every critical product invariant has an explicit contract ID;
- every contract has a canonical owner and gate;
- specialized binaries are not duplicated across gates;
- giant mixed-responsibility suites are split;
- historical tests are either active regressions or explicitly archived;
- changing a product behavior naturally points to the tests that must change.
