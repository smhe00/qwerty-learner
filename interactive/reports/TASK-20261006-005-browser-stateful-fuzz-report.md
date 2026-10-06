---
protocol_version: "1.1"
task_id: "TASK-20261006-005-browser-stateful-fuzz"
status: "PASS"
executor: "chat"
target_branch: "product/main"
accepted_candidate_head: "060895333110dd3a73598b7a7b202d02fefd2ba8"
release_to_master: false
---

# TASK-20261006-005 — P3 Browser Stateful Fuzzing

## Result

**PASS**

P3 closes the four explicit lifecycle/timing gaps from Coverage Review 3.0 with deterministic Playwright browser tests, fault injection and exact seed replay.

No P3 commit was released to `master`.

## Branch state

```text
product/main = 060895333110dd3a73598b7a7b202d02fefd2ba8
master       = 26e8454f519850374aaf9f3fd61c67c9a7222638
```

Divergence is intentional.

## Main commits

- `2373f800` — start P3 task
- `ad1467e6` — add deterministic browser lifecycle gates/fault hooks
- `3dbba8f3` — add P3 seeded stateful fuzz harness
- `a12779fd` — add P3 browser fuzz to Review Gate
- `712ff5f2` — wait for durable + settled word handoff
- `68beea35` — correctly resume Typing after blur lifecycle
- `06089533` — fault catalog v2 + P3 usage documentation

## Deterministic browser fuzzer

Core:

```text
tests/e2e/browser-stateful-fuzz-core.ts
tests/e2e/browser-stateful-fuzz.spec.ts
tests/e2e/browser-stateful-fuzz.config.ts
```

CI campaign:

```text
20 seeds × 5 actions = 100 browser lifecycle actions
clean failures = 0
```

The action generator is deterministic.

Exact replay uses:

```bash
P3_FUZZ_SEED=<seed> P3_FUZZ_STEPS=<steps> yarn test:p3-fuzz
```

Optional action-sequence ddmin uses:

```bash
P3_FUZZ_MINIMIZE=1
```

## P3 test hooks

Added:

```text
src/dev/browser-fuzz-hooks.ts
```

Test-only behavior is inactive unless Playwright explicitly defines:

```text
window.__QWERTY_P3_TEST_HOOKS__
```

Gates:

- Learn preparation
- Review persistence

Fault switches:

- stale preparation owns navigation
- desktop resize navigates root

## Closed P2 gaps

### stale async preparation wins navigation

Injected stale-owner fault is detected in real SPA navigation.

Status: **covered**.

### route-cache / IndexedDB divergence after crash/reload window

P3 deterministically observes:

```text
route index   = 1
durable index = 0
```

then destroys/reloads the document and verifies route cache preserves the newer progress and later durable state converges forward.

Status: **covered**.

### refresh during checkpoint commit window

Real persistence is held at a deterministic gate and the page reloads while the write is blocked.

Progress remains monotonic and later durable state converges.

Status: **covered**.

### viewport resize without document reload

Resize is now a seeded first-class browser action.

The injected historical resize→root-navigation mutant is killed.

Status: **covered**.

## Fault catalog v2

Final measured result from Review Gate:

```text
catalog total        42
covered              42
partial               0
uncovered             0

executable critical  29
detected             29
kill rate          100%

clean controls       11
false positives       0
```

This remains a bounded catalog result, not a universal correctness proof.

## Fuzzer false-positive investigation

Initial P3 run failed reproducibly at seed 9:

```text
complete-current
→ blur/focus
→ complete-current
```

The failure was caused by the harness recognizing only `按任意键开始`.

After blur the correct UI says `按任意键继续`.

No product bug was found.

The harness was fixed to:

1. recognize both start and continue;
2. wait for durable progress;
3. wait for the success-feedback lock window to hand off to a settled next word.

Seed 9 then passed inside the full 20-seed campaign.

## Validation

### Final Review Gate

```text
37421422769
SUCCESS
```

Includes:

- lint
- domain/acquisition/formal regressions
- P0 replay
- P1/P2 simulations
- Mutation 2.0
- Typing lifecycle browser gate
- P3 browser stateful fuzz
- build
- production navigation smoke
- multi-word Learn/Review browser gate

### Other triggered gates

```text
Achievement Gate  37421422753  SUCCESS
Cloud Sync Gate   37421422752  SUCCESS
FSRS Phase G      37421422832  SUCCESS
```

## Acceptance criteria

- [x] deterministic seeded browser fuzzer
- [x] exact seed replay
- [x] seed + action log on failure
- [x] deterministic action-sequence minimizer
- [x] 20 clean seeds
- [x] stale preparation mutation detected
- [x] refresh/checkpoint timing window exercised
- [x] resize navigation mutation detected
- [x] route-cache / IndexedDB divergence constructed and recovered
- [x] zero clean invariant failures
- [x] four P2 partial fault classes upgraded to covered
- [x] Review Gate green
- [x] no real user incident committed
- [x] master untouched

## Reviewer conclusion

P3 is accepted.

The browser harness now gives Qwerty Plus a reproducible verification layer for lifecycle races that cannot be represented faithfully by pure TypeScript simulation or TLA alone.

## Recommended next phase

Do not immediately create P4 unless there is a clear product objective.

The verification stack has reached a useful stabilization point:

```text
P0 replay
P1 model alignment
P2 mutation coverage
P3 browser lifecycle fuzz
```

The next best activity is a **stabilization/observation period** on real Learn usage, using one-click Incident export for any new field anomaly. A future P4 should be driven by either:

- a new field fault class;
- algorithm-quality goals;
- or a deliberate expansion of browser fuzz depth/nightly campaigns.
