# Verification Architecture and Gate Manifest

> Status: **canonical verification governance**

Qwerty Plus verification has grown to 81 test files and 13 workflows. The
problem is no longer a lack of tests; it is ownership, duplication, and semantic
drift.

The machine-readable source of truth is:

`tests/verification/gate-manifest.json`

The repository validates that manifest with:

`scripts/validate-gate-manifest.mjs`

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
- mutation and counterexample coverage.

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
| Learn / Review integration | Review Gate |
| FSRS package + scheduler | FSRS Phase G Gate |
| TLC models / counterexamples | TLA Gate |
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

### P0 — Governance and obvious duplication

- establish Architecture V2 and this manifest;
- validate manifest references in CI;
- stop Review Gate from directly rerunning FSRS G2/G3/G5, which are owned by
  FSRS Phase G Gate;
- stop Achievement Gate from performing a second full build when Review Gate
  already owns integration compilation for shared Learn paths;
- extract Learn settlement orchestration from React presentation.

### P1 — Split oversized suites

`tests/e2e/review-flow.spec.ts` should be decomposed by behavior:

- `learn-review-flow.spec.ts`
- `learn-acquisition-flow.spec.ts`
- `learn-recovery-flow.spec.ts`
- `learn-shell-ui.spec.ts`
- `learn-legacy-compat.spec.ts`

`tests/review/domain.test.ts` should be split by domain:

- evidence/rating;
- hint;
- acquisition;
- lifecycle;
- scheduling;
- persistence contract.

The split is organizational only: no contract is removed during P1.

### P2 — Regression inventory and deduplication

Assign persistent regression IDs to real historical defects. Merge/remove tests
only when another canonical test has the same failure signature and invariant.

### P3 — Workflow retirement

Review `.github/workflows/e2e.yml`. It currently uses a separate Node/npm
execution stack from product/main gates and is a candidate for retirement or
replacement by a release-smoke workflow.

## Success criteria

The refactor is complete when:

- every critical product invariant has an explicit contract ID;
- every contract has a canonical owner and gate;
- specialized binaries are not duplicated across gates;
- giant mixed-responsibility suites are split;
- historical tests are either active regressions or explicitly archived;
- changing a product behavior naturally points to the tests that must change.
