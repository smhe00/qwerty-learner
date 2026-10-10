# Explorer V3 — Post-holdout validation hardening

## Isolation and non-retroactive scorekeeping

The **frozen independent holdout** at commit `3e60f05` ran 16 new source mutations and caught 11/16 (68.75%). The original report and mutation manifest must remain unchanged.

This follow-up strengthens only three existing detection suites. Subsequent executions using the exact same 16 mutations are **post-holdout regression evaluations**, not fresh blind tests. Their results cannot replace or revise the original 68.75% heldout generalization figure.

## Five surviving faults and the new independent oracles

| Heldout survivor | Added assertion | Why prior test missed it |
| --- | --- | --- |
| FSRS persisted Stability accidentally zeroed | Direct `ts-fsrs` reference replay; compare stored S numerically | Prior check only asserted that Stability is finite |
| FSRS persisted Difficulty accidentally zeroed | Direct reference replay; compare stored D numerically | Prior check only asserted that Difficulty is finite |
| FSRS Due timestamp moved one day earlier | Compare exact timestamp `floor(referenceCard.due/1000)` | Due merely had to be later than the last review |
| Daily dateKey always becomes the first of the month | Explicit civil dates across consecutive days/month/year transitions and session ID identity | Previous tests checked quota and target, not exact calendar strings |
| `writer.flush()` resolves before I/O commit | Keep asynchronous controlled persistence unresolved, assert flush remains pending, then release and verify latest durable record | Previous race tests awaited enqueue writes, not flush barrier |

## Detection methodology

- Production files under `src/` are **not changed**.
- Frozen mutant definitions in `tests/simulation/explorer-v3-heldout-manifest.json` remain **byte-for-byte unchanged**.
- The FSRS reference calculation uses the public `ts-fsrs` API independently rather than using the production rebuild result as its own oracle.
- Local calendar timestamps are constructed at midday to avoid DST rollover ambiguity.
- Flush verification asserts durable completion, not merely completion of queued JavaScript microtasks.
- A compiling mutated implementation only counts as detected when an actual test assertion fails.
- CI must pass clean baselines and report valid survivors rather than hide them.
- Real-browser and cloud-account coverage remains separate: these are production-domain fault detectors, not proof of live EdgeOne account testing.

## Completion criteria

Run the heldout mutation workflow again on the follow-up commit; archive its scorecard and state the post-holdout detection rate. Check Review Gate and Pages Explorer separately, because the mutations-only workflow success does not imply the entire branch passes. Keep both original and follow-up scores visible.
