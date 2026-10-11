# TASK-20261011-018 — Startup / Sync P0-P1 gate verification

**Date:** 2026-10-11  
**Verifier:** ChatGPT, GitHub Actions (real CI execution)  
**Feature branch:** `feature/perf-boot-sync-p0-p1-20261011`  
**PR:** https://github.com/smhe00/qwerty-learner/pull/4  
**Verified feature SHA:** `e81c4141b7320ac77c9dbc75082a8fd34a377e19`  
**GitHub Actions:** https://github.com/smhe00/qwerty-learner/actions/runs/38153824850  
**Outcome:** Feature-branch CI PASS; production release NOT authorized or performed.

## Verified

| Check | Result | Evidence |
| --- | --- | --- |
| Cloud S1/S2/V4 + P0 regression contracts | PASS, **130/130**, 0 failures | GitHub Actions run 38153824850 |
| Historic V4 canonical digest and EdgeOne server parity | PASS | `tests/cloud/perf-canonical-v4.test.mjs`, executed by cloud contract gate |
| Manual S2 metadata/capture overlap after flush | PASS | `tests/cloud/sync-v2-manual-executor.test.mjs`, executed by cloud contract gate |
| Server and cloud test ESLint | PASS | same run |
| Frontend sync/index/dictionary ESLint | PASS | same run |
| Production Vite build | PASS | same run |
| Local Chrome browser: fresh boot and report navigation | PASS | `tests/e2e/perf-report-local.spec.ts` |
| Local Chrome browser: performance JSON export + redaction | PASS, **2/2 browser tests** | same spec and run |
| Strict TypeScript baseline differential | PASS: 94 baseline / 94 candidate / **0 introduced** | compare exact error path, code and normalized message against `product/main` |
| Standalone strict TypeScript check | **Not green:** 94 pre-existing repository errors | TypeScript `target=es5` and existing type errors; known baseline debt |

## Synthetic CPU performance benchmark

Fixture: 4,096 shuffled V4 word rows with historical events; same Node.js 20 GitHub runner. Three samples, median each; the benchmark also compares exact canonical JSON outputs.

- **Historical repeated-key comparator:** 633.0 ms.
- **Cached-key canonical sorter:** 46.6 ms.
- **Sort-stage speedup:** **13.57×**.
- Browser and EdgeOne canonical SHA compatibility tests passed.

**Limitations:** This is Node CPU time for canonical sorting ONLY. It does not measure complete Sync V4, Dexie six-table export/audit, gzip, cloud RTT, mobile hardware, or full-page reload time. Do not advertise overall Sync as 13.57× faster.

## Findings during verification

1. Initial TypeScript diagnostics identified a new `src/index.tsx` callback narrowing regression; fixed on the feature branch.
2. Initial browser test lint attempt conflicted with the repository's existing `tests/e2e` ESLint scope (test parser, not production code); the production lint gate remains green.
3. Old Playwright `--with-deps` installer requested unavailable Ubuntu 24.04 `libasound2`; browser validation now uses the runner's preinstalled Chrome and passed.
4. Strict TypeScript remains nonzero at both baseline and candidate: **94/94 identical diagnostic signatures**.

## Pending before production release

- PR #4 is still a draft and **not merged to `product/main`**.
- Run the standard Cloud Sync Gate on `product/main` after integration.
- Test actual S1 authenticated workspace with 100/1,000/10,000+ seeded Dexie records on a disposable nonproduction environment. Confirm No-op, Push, Pull, crash journal replay, and conflict/no-data-loss behavior under a real browser.
- Collect cold/warm startup and full Sync-noop / Sync-Push end-to-end latency breakdown (or a user-exported local diagnostic JSON). Sorting speedup is not an end-to-end speedup.
- No master or EdgeOne production publish. No real user accounts were touched.
- No unsafe dirty-cache no-op short circuit, no S1 writer-lock relaxation, and no removal of V4 six-table audits.

## Next decision

**Eligible for PR review and controlled development integration** based on pure contracts, build, Chrome smoke and typecheck differential. **Not yet signed off for `master` production release** until authenticated Sync E2E and end-to-end performance measurements are complete.
