# Explorer V3 — Mutation-based Defect Detection Audit

## What is being measured

The established Explorer V3 Pages browser suite proves successful user flows. It does not, by itself, prove an ability to detect mistakes that a user would notice. This experiment measures **fault detection**, with deliberately injected defects in a completely isolated test environment.

The workflow **Explorer V3 Mutation Detection Audit** runs on `product/main` and has two independently labeled arms:

1. **Blind user-action campaign:** 14 mutation types are enabled individually in `VirtualLearnApp`. Each case runs six deterministic, randomized action histories of 220 steps, across fresh, warm or due profiles. The generic anomaly oracle receives naturally generated trace events, not manually constructed anomaly events. The scorecard reports exactly which fault types and seed trials were detected, which survived, and the false-positive rate of 18 unchanged control runs. The injected fault is never disclosed to the action generator.
2. **In-memory production source mutations:** six mutations alter real `src/learn/` function source text only inside esbuild's temporary `onLoad` callback. The existing V3 domain boundary tests are then executed against that mutated build. No repository file is altered. Baseline must pass. A mutant counts as detected **only** if its bundle compiles and the tests fail; a compilation error cannot be counted as a kill. Survivors and invalid mutations remain visible in the result.

## Interpretation

- `killedTrials / seedTrials` measures successful detection in the stochastic simulated-user arm, **not** real-browser defect detection.
- `killed / validMutants` measures detection by explicit production-domain boundary assertions in the second arm, **not** the random Explorer.
- A fault that does not activate during a run may survive; these are conservatively counted as surviving trials. Never delete such failures to inflate the kill ratio.
- Cases where clean controls raise an anomaly are false positives and block this experiment.
- Reporting artifact and reproducible seeds provide the starting point for strengthening the Explorer. Do **not** silently change the expected answer when a mutant survives.
- Existing Pages browser tests remain unmodified and no mutations reach `master`, `gh-pages`, EdgeOne, cloud accounts, or persistent user databases.

## Advancement criteria

First measure and report a credible kill score. Then choose the highest-impact survivors, reproduce the failure condition, and add a general invariant or coverage-guided action sequence. Re-run the **same** campaign and compare kill rate without increasing baseline false positives. Only then consider a new real-browser mutation lane.

## Source references

- `tests/simulation/explorer-mutation-detection-v3.test.ts`: blind behavioral mutants.
- `scripts/explorer-source-mutants.mjs`: in-memory production-source mutants.
- `.github/workflows/explorer-mutation-audit.yml`: executable measurements, logs and summary.
- `tests/simulation/system-explorer-v3-coverage.test.ts`: unchanged production-domain invariants used as the source-mutation kill oracle.

## Coverage-guided extension

The original blind randomized campaign is retained without changing its six seeds, 220 actions, or 14 mutations; this keeps the **61/84 = 72.6%** baseline comparable. Four supplemental **risk-state profiles** use the same action policy, but establish preconditions that are rare in purely random histories:

- New-word headroom: daily target 3 vs. dictionary 24, so selecting a fourth word is observable.
- Introduced-but-unacquired: a genuine persisted Exposure record with daily target 1.
- Old checkpoint: a snapshot is captured, then genuine durable progress is made before leaving and restoring.
- Ready Deferred: a pending acquisition is eligible and is presented to repeated scheduler opportunities.

Every guided scenario also runs **unmodified controls** with identical action policies. A survivor is reported even if its faulty precondition was not exercised; a crash is reported separately from a semantic oracle detection.

The generic `system-oracle.ts` is strengthened with a ceiling derived solely from observed target, Introduced and unseen counts. It does not accept a mutated planner's self-reported `expectedAllowedNow` as sufficient evidence. Separately, domain-boundary test C6 asserts quota on an introduced but not acquired word, and C7 asserts the public four-way start-kind truth table for mixed due/new work. No product source or production branch changes are required.

## Verified detection improvement (2026-10-10)

The audit run [38013776392](https://github.com/smhe00/qwerty-learner/actions/runs/38013776392) confirmed the following using the **same fixed mutation catalog**:

| Measurement | Original | After coverage guidance |
| --- | ---: | ---: |
| Unchanged blind random exploration | 61/84 = **72.6%** | **61/84 = 72.6%** (preserved for honest comparison) |
| Four focused risk profiles | Not measured | **24/24 = 100%** |
| Combined mutant/seed detection, blind OR guided | **61/84 = 72.6%** | **84/84 = 100%** |
| Production-source mutations detected by executable domain invariants | **4/6 = 66.7%** | **6/6 = 100%** |
| Clean controls / false positives | 18 / 0 | **42 / 0** (18 blind + 24 guided) |

The last checkpoint blind spot required a *durably saved* historical snapshot before forward progress; seeding a snapshot before any saved checkpoint did not provide a distinguishable checkpoint history. Coverage guidance creates that valid prerequisite and checks that the generic checkpoint-regression oracle identifies a stale restore. This is test-only setup, not production code mutation.

**Interpretation:** 100% refers only to the current **14 known injected behavioral fault types under six fixed seeds, each with targeted risk-state preconditions**, and to six known production-source mutations. It is **not** an estimate of general real-world defect recall, nor a claim that an equivalent live-browser fault has been detected. The original 72.6% undirected score stays visible for that reason.

After verification, both suites assert the minimum detection contract in CI so a future regression cannot silently lower the fixed-catalog detection score. The full machine-readable scorecard remains an Actions artifact.
