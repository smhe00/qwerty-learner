# Explorer V3 independent heldout mutation audit

## Purpose
Evaluate generalization of Explorer V3 beyond the 14 behavioral mutants and 6 domain source mutants used during development. The holdout manifest is **frozen before the first CI execution**, with no test changes, no post-run replacement of survivors, and no alteration of production code. It is a distinct score from the previously reported optimized 84/84, 6/6.

## Four independent domains

1. **FSRS-6 state replay (6 mutants)**: review count, lapse count, last rating, persisted D and S, and due time.
2. **Cross-day planning (4 mutants)**: due review selection, carry-over acquisition, review quota accounting and calendar day keys.
3. **Concurrent persistence (4 mutants)**: writer order, immutable snapshot, failure recovery and early flush acknowledgement.
4. **Unexpected refresh (2 mutants)**: ignoring unfinished sessions entirely or only accepting checkpoints with cursor 0.

## Frozen evaluation

Manifest: `tests/simulation/explorer-v3-heldout-manifest.json`.

Runner: `scripts/explorer-heldout-mutants.mjs`.

Detectors are **existing, unchanged** tests: `tests/fsrs/g5-active-scheduler.test.ts`, `tests/learn/daily-session.test.ts`, `tests/simulation/persistence-race.test.ts`, `tests/simulation/system-explorer.test.ts`. For each suite, run a clean baseline first. Each source mutation changes one specific source span only within esbuild's temporary in-memory onLoad, never changing the repository checkout.

Classification:
- **Killed**: mutant compiles and an existing test assertion fails.
- **Survived**: mutant compiles and the existing test suite passes.
- **Invalid**: cannot compile, cannot apply uniquely, or times out without an assertion verdict; excluded from kill-rate denominator, separately reported.
- If a baseline fails the entire holdout is invalid.
- All per-category and aggregate counts, including named survivors, are mandatory evidence.

**No minimum kill rate is imposed on the first run.** It is a measurement, not a benchmark tuned for 100%.

The primary deliverable is a list of previously unknown *test weaknesses*. A surviving mutant is not proof of a product bug, and a caught mutation is not proof that a real browser E2E journey would detect the same defect. Follow-up changes, if any, must be a **separate post-holdout experiment** and must not retroactively change this frozen score.

## Production safety

Only files under `tests/`, `scripts/`, `.github/workflows/`, and `docs/` may change. Do not update `master` or EdgeOne. No live test accounts or cloud writes.
