# Circle bounded parallel replay — verification (2026-10-16)

Status: **offline + isolated real Blob gate PASS**. Proposed for product/main review; **not a Circle release or HTTP E2E approval**.

## Change

- `createCircleEventLog(blob, { readConcurrency = 8 })` issues at most 8 in-flight Blob GETs when replaying a list of known event keys. The limit is configurable in the range 1–32.
- Validates all listed object keys before any GET. A listed key that reads null, is malformed, or conflicts with its identity aborts the **entire** scan; it is never silently omitted.
- Preserves the listing order in the returned event array. Reducer convergence and logical dedup continue to be based on event identity, not arrival timing.
- Does not change the append-only Blob event model, introduce CAS, rely on atomic reads, bypass member access checks, or modify Cloud V4 payloads.

## Evidence (feature/circle-parallel-replay-20261016)

- [Circle Core Gate #38795474942](https://github.com/smhe00/qwerty-learner/actions/runs/38795474942): PASS, Circle **100/100**, existing V4 backend **59/59**, syntax, scoped ESLint and frontend Vite build PASS. Tests explicitly cover 3 concurrent reads, single-read fallback, bad configuration, malformed listing refusing ALL GETs, and failure to assemble an incomplete view.
- [Isolated EdgeOne Blob SDK #38795700711](https://github.com/smhe00/qwerty-learner/actions/runs/38795700711): PASS using the separate **qwerty-circle-sandbox** Store, not production V4 Store. 15 unique temporary physical events; concurrent join, remove-wins and close-wins converged; all 15 test objects cleaned up with zero reported cleanup failures.
- Same 15-event fully visible snapshot: sequential GET loop **6541 ms**, bounded 8-concurrent GET **1567 ms**, equivalent event-ID sets. Measured ratio ~4.17x and elapsed-time reduction ~76%. **One run only**; timing includes network variability, caching, request ordering and SDK/provider factors. No general speed/SLA promise.
- Probe uses GitHub Actions and SDK token targeting only the isolated sandbox. **No EdgeOne Maker deployment.**

## Outstanding gates

1. No verified authenticated Etest Circle API E2E. `CIRCLE_ETEST_ENABLED`, separate Blob binding, private invite secret and disposal-only allowlist require controlled activation.
2. Circle user-facing UI is not complete.
3. Circle account-deletion retirement / repeatable social-data scrub needs a full design and end-to-end privacy verification before GA.
4. Eventual consistency means that a removed member or a recently closed Circle may temporarily remain visible on a stale node. Bounded parallel read **does not** solve that limitation.
5. Long-run/performance thresholds beyond the 2000-event Etest cap are not established.

Do not publish Circle by merely merging this performance change. Keep production Circle HTTP routes closed and test-only etest configuration isolated.
