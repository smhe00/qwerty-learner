# Verification Inventory — 2026-10-08

This is the baseline inventory for the Qwerty Plus verification refactor.

## Repository scale

At the start of this refactor:

- **81** files under `tests/`
- **13** GitHub workflow files
- **304** files under `src/`

Largest verification files:

| File | Approx. size | Role |
| --- | ---: | --- |
| `tests/e2e/review-flow.spec.ts` | 114 KB | 44 mixed browser scenarios |
| `tests/review/domain.test.ts` | 105 KB | 101 mixed domain tests |
| `tests/review/formal-model.test.ts` | 65 KB | JS formal/state model |
| `tests/simulation/system-driver.ts` | 53 KB | production-backed simulator |
| `tests/simulation/system-driver.test.ts` | 38 KB | 40 system invariants |
| `tests/e2e/review.spec.ts` | 35 KB | 40 pure domain tests using Playwright runner |

The primary problem is **mixed ownership and historical layering**, not simply
the number of assertions.

## Immediate findings

### 1. Review Gate duplicated FSRS execution

Review Gate reran:

- G2 live-shadow;
- G3 analysis;
- G5 active scheduler.

Those binaries already belong to **FSRS Phase G Gate**.

**Action:** removed from Review Gate. Review integration still exercises FSRS
through normal Learn/Review paths; specialized FSRS binaries now have one
canonical owner.

### 2. Docs triggered heavyweight behavior gates

Historical `docs/REVIEW_*.md` and `docs/LEARN_*.md` changes triggered the
full Review Gate.

**Action:** removed docs-only triggers. Behavior gates now follow executable
changes, tests, or the machine-readable gate manifest.

### 3. Learn settlement logic was embedded in presentation

`LearnResultScreen` owned achievement settlement, persistence barriers,
DailySession completion, and cloud-sync decisions.

**Action:** extracted the durable coordinator into
`src/learn/settlement.ts`. The React component now subscribes to the domain
operation and renders/control-flows the result.

This directly protects the StrictMode failure class discovered before the last
release.

### 4. `tests/e2e/review.spec.ts` is not E2E

The file contains **40 pure domain tests** and imports review functions directly;
it does not exercise a browser page.

It overlaps current `tests/review/domain.test.ts` for:

- classifier;
- due selection;
- rebuild;
- scheduler;
- reinforcement/session;
- review state types.

It still contains unique historical coverage around:

- diagnostics;
- feature summarization;
- learning-context capture;
- priority ranking;
- telemetry.

**Decision:** do **not** delete it yet. First migrate unique coverage into
domain-owned suites, prove overlap, then remove the Playwright-domain duplicate.

## P1 split plan

### Browser suite

Split `tests/e2e/review-flow.spec.ts` into:

1. `learn-review-flow.spec.ts`
2. `learn-acquisition-flow.spec.ts`
3. `learn-recovery-flow.spec.ts`
4. `learn-shell-ui.spec.ts`
5. `learn-legacy-compat.spec.ts`

Shared seed/read helpers should move into a dedicated harness module before the
test bodies move. No behavior assertion is deleted during the split.

### Domain suite

Split `tests/review/domain.test.ts` into contracts by owner:

1. evidence/rating;
2. hint;
3. acquisition/scaffold;
4. lifecycle/selection;
5. scheduler/rebuild;
6. persistence/session;
7. quota/strain diagnostics.

The old P3/P4 quota tests must be explicitly labeled as **diagnostic/fallback
policy** where the current product supplies an explicit DailySession target.
They must not be described as current user-facing quota semantics.

## P2 deletion criteria

A test can be deleted only when all are true:

1. its contract ID is known;
2. another canonical test covers the same invariant/failure signature;
3. the canonical owner Gate executes that replacement;
4. no unique regression history is lost.

Tests that protect a real user-observed defect should receive a durable
regression ID before any consolidation.

## Workflow cleanup candidates

### `.github/workflows/e2e.yml`

Current characteristics:

- runs only on `master` / `dev/e2e`;
- Node 18;
- npm install despite the product using Yarn;
- old GitHub Action major versions;
- runs the entire Playwright tree again after product/main gates.

It is a candidate for replacement by a small **release smoke** workflow after
the orphan/mislocated `tests/e2e/review.spec.ts` coverage is migrated.

It should not be deleted before that migration, because it is currently the only
workflow that may execute some of those legacy domain tests.

## Current canonical sources

- Architecture: `docs/ARCHITECTURE_V2.md`
- Verification governance: `docs/verification/GATE_MANIFEST.md`
- Executable ownership: `tests/verification/gate-manifest.json`
- Manifest validator: `scripts/validate-gate-manifest.mjs`

Historical phase documents remain evidence, not current product contracts.
