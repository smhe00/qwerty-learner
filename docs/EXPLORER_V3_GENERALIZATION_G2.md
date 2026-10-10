# Explorer V3 — G2 Independent Generalization Holdout

## Frozen before execution
On 2026-10-10, G2 freezes 16 **new, never optimized** production-source mutation definitions at:
- `tests/simulation/explorer-v3-generalization-g2-manifest.json`
- `scripts/explorer-generalization-g2.mjs`

G2 is distinct from the original G1 heldout (11/16) and the post-G1 enhancement score (16/16). No G1 mutant appears in G2. G2 tests novel faults in five domains: FSRS replay chronology/ratings/clean-streak; long-term rating eligibility and legacy re-inference; asynchronous ownership cancellation; assisted recovery-window safety; cloud-sync divergence and upload arbitration.

The original G2 score must be archived unchanged before any further detection-system modifications.

## Honest scoring
- Baseline uses existing `g5-active-scheduler`, `acquisition-domain`, `async-ownership`, `scaffold-recovery` and `daily-session` test suites, untouched for G2.
- Mutations are injected into production source text **inside isolated esbuild bundles only**. No production code or persistent user data are modified.
- `killed`: the mutant bundles and fails a test assertion.
- `survived`: the mutant bundles and all detector assertions pass.
- `invalid`: compiler failure, timeout or inability to apply the source change; excluded from detection-rate denominator and shown separately.
- A baseline failure invalidates the run. No minimum kill rate, and no change to the manifest or tests in response to initial results.
- CI green means a valid measurement, **not** 100% fault detection.

These source-level domain tests measure whether existing detection gates can catch a fault in a real function. They are not the same as a Playwright real-browser explorer killing the same faults. Production `master` and EdgeOne remain untouched.

## Follow-up
After the heldout score is frozen, review all survivors and separate unexercised test paths from weak assertions and genuinely equivalent mutations. Improve coverage only in a **separate** post-heldout commit and report both original and post-holdout figures.
