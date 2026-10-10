# Explorer V3 — G2 Post-Holdout Coverage Hardening

## Unchanged original independent score

The genuinely new G2 mutation manifest was frozen at `aa3bbd1`, before any new assertions. The original independent measurement was **7/16 (43.75%), 9 survivors, 0 invalid, all 5 clean baselines passing**. Its [GitHub Actions run](https://github.com/smhe00/qwerty-learner/actions/runs/38024185883) is the honest generalization metric and must never be replaced by a later score.

## Post-holdout changes (tests only)

All 16 original mutants remain frozen byte-for-byte. The following nine detection gaps are now probed by independent assertions in existing domain test suites:

| Previously surviving mutation | Additional legitimate evidence |
|---|---|
| FSRS initial Due delayed by a day | Admission-only timeline: exact `t0 + 86400` with no Review rating |
| FSRS cleanStreak double-counted | Good and Hard each add exactly one; Again resets to zero |
| Explicitly ineligible Rating replayed | Ineligible Review record with stale/missing rating yields no scheduler outcome |
| Typing record accepted as Review | Positive Rating cannot override Typing provenance |
| Clean legacy record inferred as Good | No independent evidence/telemetry means no positive Review outcome |
| Deactivated ownership accepts new claim | Begin while inactive stays invalid until explicit activation |
| Old callback invalidates newer owner | Old claim's invalidate cannot cancel the latest live generation |
| Recovery Window scans past 8 slots | Only eligible word at index 9 must never be pulled into near-term recovery |
| Sync simultaneous edits misclassified | Derive `diverged` from actual local changes + remote revision advance; auto upload forbidden |

Original clean controls still run first. All changes are restricted to `tests/`, this document and workflow triggers; neither production Learn/FSRS/Sync source code nor the frozen mutation manifest/runner is altered.

The rerun is a **post-G2 hardening score**, not another independent blind score. A mutant is killed only when its valid source mutation actually causes an existing assertion to fail. A green CI workflow means a valid measurement; the machine-readable report names any surviving mutants.

## Next objective

Do not continue tuning the disclosed G2 catalog after results are recorded. Design a new G3 blind evaluation with genuinely novel failure modes and specify detection thresholds *before* seeing the outcomes. Gradually extend toward stateful multi-device and real-browser failure injection, separately from source-level tests.
