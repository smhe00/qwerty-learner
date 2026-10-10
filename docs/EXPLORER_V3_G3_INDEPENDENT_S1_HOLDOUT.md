# Explorer V3 G3 — Unseen S1 Workspace / Backup V4 mutation audit

## First-run protocol (frozen before CI)

The original G1/G2 blind scores are retained: G1 was 11/16, and G2 was 7/16. Both reached 16/16 only **after** post-holdout coverage improvements. G3 does **not** repeat or alter those known mutants.

G3 injects **20 new faults**, defined before execution in `tests/simulation/explorer-v3-s1-g3-manifest.json`:
- **12 workspace transition faults**: flush-before-save, source vault isolation, direct account switching, pending journal arbitration, transaction ordering, crash recovery, source/target identity, UI callbacks.
- **8 Backup V4 faults**: private auth credential leakage, unfinished DailySession loss, corrupted-state acceptance, metadata/order fingerprint instability, ignored navigation updates and invalid identity acceptance.

These risks matter because Qwerty Plus allows multi-account workflows and may resume after crashes, offline gaps or browser reloads. However G3 at present is **S1/Backup V4 *domain source mutation***; it does **not** simulate a real EdgeOne multi-device cloud service or inject faults into live Pages/Playwright, and should not be described as doing so.

## Rigorous execution

The runner copies a changed production source into `.mutation-audit/g3/`, runs a compile preflight, and points an **unchanged existing test suite** to that isolated copy. It does not edit `src/`, existing tests, `master`, EdgeOne production, browser storage, or user accounts. For each of the two domains, first run its clean baseline. Existing detectors:
- `tests/cloud/workspace-transition.test.mjs`
- `tests/cloud/workspace-v4.test.mjs`

Classification: **killed** only for compiled mutants that trigger named test assertion failures; **survived** for a compiling mutant that passes all tests; **invalid** for compile/harness failure or timeout, excluded from rate with explicit accounting. A clean baseline is mandatory. Zero imposed kill-rate threshold: CI green represents a valid measurement rather than perfect detection.

Keep the initial first-run score frozen. Any improvements must be committed separately with both before and after scores reported. Alongside G3, the existing GitHub Pages Browser Explorer still tests real UI, but it is a separate lane and its passing score is not included in mutant kills.

## Next steps

Analyze surviving faults by impact, then extend toward actual multi-client browser fault injection with disposable identities/storage and explicit safety controls. Do not extrapolate a source-level kill rate into general defect-detection recall.
