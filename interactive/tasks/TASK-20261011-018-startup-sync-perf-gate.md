---
protocol_version: "1.1"
task_id: "TASK-20261011-018-startup-sync-perf-gate"
task_file: "interactive/tasks/TASK-20261011-018-startup-sync-perf-gate.md"
report_file: "interactive/reports/TASK-20261011-018-startup-sync-perf-gate-report.md"
target_branch: "feature/perf-boot-sync-p0-p1-20261011"
source_branch: "product/main"
review_pr: 4
status: "READY_FOR_AGENT"
executor: "Code agent"
release_to_master: false
priority: "P0"
---

# Qwerty Plus — Start-up / manual Sync P0/P1 verification and refinement

## User-facing issue

Starting the website and manually synchronizing learning progress feel slow.
**Code-level root causes** include repeated full V4 export/row audit, canonical
sort comparisons serializing each record repeatedly, sequential network metadata
request and two full page navigations for pre-mount S1 safety.

## Work already in PR #4

Feature branch `feature/perf-boot-sync-p0-p1-20261011` includes:
- Browser/server cache of V4 canonical sort keys (must keep old digest parity).
- Read-only cloud metadata fetch in parallel with full local capture after writer flush.
- Stage-level local timing for bootstrap, dictionary and sync.
- Exportable report `/?perf-report=view`, visible from Settings.
- Raw JSON UTF-8 and gzip payload byte counts.
- Browser/server old/new digest parity test, S2 concurrency test, diagnostics tests.

## Agent tasks

1. Fetch feature branch and review **entire** PR diff against latest `product/main`.
   Do not switch to `master`, or touch cloud storage/actual user accounts.
2. Run `yarn install --frozen-lockfile`, `yarn test:cloud`,
   `yarn eslint cloud-functions tests/cloud --ext .js,.mjs`,
   `yarn eslint src/sync src/utils/wordListFetcher.ts src/index.tsx
   --ext .ts,.tsx`, `yarn build` and an appropriate TypeScript-only check.
   Fix failures on feature branch, not on `master`.
3. Verify no regression in S1 writer lease, auth isolation, journal replay,
   V4 completeness audit, old/new browser/server logical fingerprint,
   S2 revision CAS (including conflicting remote revisions), and no silent data overwrite.
4. Validate report contains only stage name, duration and aggregate bytes,
   survives the two page reloads, is bounded, and remains non-blocking when
   sessionStorage is full or disabled.
5. Browser E2E on Page test deployment only if available **without EdgeOne Maker
   builds**, using seeded local IndexedDB data (empty, ~100, ~1000, ~10000 rows).
   Collect startup cold/warm cache, Sync identical/no-op, changed/push and
   Pull/crash-recovery duration breakdown.
6. Correct any discovered regressions and write the results as the declared
   report Markdown with commit SHA, pass/fail counts, measured timings, and
   a precise list of unresolved issues.
7. Only after all mandatory gates are green, mark PR ready and merge into
   `product/main` (no `master` deployment). No real user's EdgeOne account
   may be touched by synthetic tests.
8. **Do not implement a dirty-cache no-op short circuit without complete
   persisted-writer coverage** across six tables, Learn sessions, settings,
   navigation, crash recovery and account changes. See
   `docs/PERFORMANCE_STARTUP_SYNC_20261011.md` for the required contract.
   Escalate this fast path as a separate design / test gate.

## Nonnegotiable safety

- No S1 lock bypass or in-place live React Sync to eliminate two navigations.
- No weakening of V4 six-table record audit, per-row semantics, Gzip SHA,
  logical fingerprint, revision CAS, or cloud-owner identity.
- Never update `master` or cause an EdgeOne Maker build as part of this task.
- Do not claim verified speedups without measured timings and a baseline.
