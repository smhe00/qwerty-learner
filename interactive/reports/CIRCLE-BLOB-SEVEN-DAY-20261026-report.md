# Seven-day Circle implementation report

Status: REVIEW — development implementation and local validation complete; not released.
Execution base: 12c2069469c0c00d85f2e9c238eb4e2c2b955f01.
Claim commit: 875c82a.
Implementation commit: 5e39a0c0393b729d1f2329be3c45f746f376638a.
Workspace: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-circle-blob-seven-day.
Executor: Codex-circle-seven-day.

## Outcome

New Circle creation uses private social/v3 Blob objects, stable strong-confirmed membership and advisory 50-member / three-circle checks. Activity is day-partitioned and limited to today plus six Beijing calendar days. Stable per-actor facts preserve progress OR/MAX and clap deduplication. One source-validated summary object per day avoids both repeated raw reads and accumulating aggregate versions. Public v3 views return reactionCounts to stay within the existing response budget.

Current action routes remain under /api/circle/v2; mine and dated aggregate reads are added. QC2 and legacy IDs continue through the preserved v2 service, including legacy creation retry defaults. No migration or legacy deletion is performed. The account-deletion hold, V4 session verification, IP/account budgets and owner checks remain.

An operator script provides bounded dry-run/execute cleanup and atomic local checkpoint replacement. It drains inactive circles too, validates deletion scope/date on resume, and never deletes durable control/current/v2 objects. It is not scheduled or executed against live storage in this task.

PR #17 was inspected, marked superseded and closed at the owner's request, without merging or deleting its branch:
https://github.com/smhe00/qwerty-learner/pull/17

## Files and design refinements

- bounded-storage.js: exact v3 key scope, consistency/readback, deletion hold, bounded pagination/parallel reads.
- bounded-service.js: membership/index repair, advisory limits, lifecycle, authenticated seven-day APIs and v2 fallback.
- daily-view.js: immutable record integrity, deterministic aggregation, daily cache fingerprint/content validation and live member filtering.
- maintenance.js and scripts/circle-v3-maintenance.mjs: bounded resumable operator cleanup, no live scheduling.
- open-gateway.js and transport.js: existing authenticated gateway integration, added reads, accurate response consistency.
- tests/cloud/circle-seven-day.test.mjs: 17 new integrated/fault tests; old gateway fixtures explicitly retain legacy coverage.
- .github/workflows/circle-core-gate.yml: new regression/maintenance syntax/lint coverage.
- docs/CIRCLE_BLOB_SEVEN_DAY_V3.md plus notices in seven historical Circle documents.

Initial design considered a separate summary key for every source hash. Review changed this to one replaceable view.json with its source hash inside: older concurrent cache writes are detected by the next read, and repeated small updates cannot accumulate summary generations. Retention only deletes expired partitions. The operator drains from the first page after deletion, avoiding offset-cursor skips without retaining an unbounded inventory.

## Validation (local, 2026-10-26)

1. Final Circle suites: **118/118 passed**, zero skipped:
   node --test tests/cloud/circle-seven-day.test.mjs tests/cloud/circle-core.test.mjs tests/cloud/circle-trusted-access.test.mjs tests/cloud/circle-eventual-access.test.mjs tests/cloud/circle-etest-gateway.test.mjs tests/cloud/circle-open-gateway.test.mjs

   New tests include repeated join/leave with stable object count; removed-member return; create retry/conflict/closure; three-circle and 50-member advisory behavior; 51-member concurrent admission; partial index/member writes; unknown DELETE/readback; deletion hold ordering; conflicting progress operations; persisted summary I/O; late/stale summary writes; current-membership filtering; Beijing midnight/leap day; missing/forged source and cursor failures; revoked session; legacy/default HTTP gateway; all 2,450 directed claps among 50 members fitting 64 KiB; dry-run/forged cleanup checkpoints; and interruption-safe purge of 10,001 expired records.

2. Relevant V4 regression selection: **70 tests passed across six suites**:
   backend-core, multi-session-auth, edgeone-blob-storage, s2-write-route, v4-http-parts, v4-http-part-retry.

   Initial restricted invocation passed 46 tests; two test files could not initialize because the read-only sandbox blocked esbuild ancestor access and temporary-directory creation. Re-running only those two with the necessary execution permission passed **24/24**. No assertions/gates were weakened.

3. Scoped ESLint passed for Circle modules and changed tests. Maintenance script ESLint and node --check passed. The production entry point node --check passed.

4. yarn build passed (Vite 4, 4,378 modules; build 49.70s / command 62.41s). Existing diagnostics remain: outdated Browserslist data, ignored dependency "use client" directives, and large chunks. No dependency, UI or learning-state changes were made.

5. git diff --check passed. Upstream fetch after implementation found origin/product/main unchanged at the claim commit. Final push/remote state is recorded below.

No live EdgeOne account, Blob, browser or physical-device validation was performed. Local successful tests are not exact-SHA etest/master release evidence.

## Remaining rollout boundaries

- master and edgeone-test were not advanced. No Maker build or production release was requested/performed.
- Qualify the exact candidate on etest for actual strong reads/deletes, eventual activity visibility, pagination, real sessions and maintenance before release.
- Provision an independent scheduled cleanup worker during the authorized rollout. API visibility expires at seven calendar days immediately; physical bytes expire on subsequent sweeps, not native TTL. This development task does not claim that an inactive production circle is already physically cleaned.
- v3-only mine/limits/retention exclude legacy QC2 circles; legacy migration and Circle UI are separate work.
- Admission is advisory. Clients must serialize membership actions and stop stale join retries; delayed joins and temporary index inconsistencies under competing actions are accepted tradeoffs. Stable same-operation retries repair partial index/member writes.
- Conservative account deletion remains held pending a separately qualified erasure workflow; seven-day cleanup does not remove that hold.

Next owner decision is staging/release qualification when desired, not another implementation-permission request.

## Development push checkpoint

Implementation 5e39a0c0393b729d1f2329be3c45f746f376638a was pushed normally to product/main. git ls-remote confirmed that exact remote head. The working tree was clean after that push. This follow-up commit records the immutable implementation SHA and evidence only; it changes no application code. Local validation above applies to that implementation. Auto-triggered CI/Pages results are not claimed here; etest/master remain untouched.
