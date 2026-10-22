# Mobile account writer handoff

2026-10-23 Asia/Shanghai. REVIEW; exact-SHA CI and etest deployment pending. Base 09383bdb306494d8d3a0788c7e77261881a50485. CURRENT_TASK remains owned by the independent cloud-convergence executor. No Huawei real-device reproduction or confirmed root cause claimed.

## Problem and change

User sees writer contention on Huawei Chromium-based browser immediately after tapping home login, before credentials. Both account links were ordinary anchors. Normal taps now prevent default link handling and explicitly navigate the current context (target=_self + location.assign); intentional modifier activation retains native link semantics. This covers embedder new-link policies without creating a second mounted writer.

Mobile account boot alone retries contention for a 3-second budget, always acquiring the same native + IDB election; it never steals or releases another writer. All other callers retain immediate conflict detection. Genuine persistent contention keeps React/account UI unmounted and exposes an in-place retry. Each retry performs full guarded bootstrap and journal/identity checks before showing credentials. Non-contention storage errors are not retried. pagehide retention and existing learning records are unchanged.

## Changed files

- src/pages/Mobile/index.tsx: explicit same-context normal account activation, both entries.
- src/sync/workspace-lock.ts: bounded non-stealing retries around the unchanged single acquisition.
- src/sync/workspace-bootstrap.ts: optional writerWaitMs passed to the lease.
- src/index.tsx: mobile-account-only wait and pre-mount retry; neutral occupation text.
- tests/e2e/mobile-account-writer.spec.ts and mobile-account.config.ts: 6 tests included in Mobile P0 Gate.

## Local evidence

- Mobile account full suite 17/17 PASS (77.30s), including 6 new cases: touch/keyboard same-context under simulated embedder policy, native/fallback delayed release recovery, native/fallback persistent exclusion and recovery with same document after owner release. Seeded record counts preserved; blocked/retry paths issue no auth requests.
- Regression proof: temporarily restored original Mobile/index.tsx and workspace-lock.ts from base; the new embedder-policy and delayed-native-release tests both FAIL at the expected assertions. Current implementation restored byte-for-byte in finally. This is a simulated regression, not Huawei-device reproduction.
- Existing compatibility selection: 10/11 PASS; all 9 workspace-lock-compat tests and pagehide safety pass. Original desktop first-load case hits its existing 5-second settings-button deadline before checking exclusivity, repeated solo with same result. No assertions or committed timeout were changed. A temporary untracked config allowing 30 seconds for first startup passed the identical exclusivity assertions 1/1 (15.56s); production test deadline remains unchanged.
- New test first run: 5/6 PASS, first mobile menu failed at cold initial load 5s before navigation; only the new test's initial load wait set to 30s, then full 17/17 PASS.
- Normal build and cloud-disabled Pages build PASS. Pages mobile preview 3/3 PASS, including legacy data + saved credentials with zero API calls.
- Architecture boundaries PASS (62 Learn/Review modules + 3 low-level files).
- Repository lint PASS: 0 errors, existing 120 warnings. Repository tsc remains nonzero with 139 source diagnostics, none in changed source files; no full typecheck-green claim.
- Cloud Node local: 519 PASS / 1 FAIL (520 total). Failure is s2-write-route.test.mjs Windows URL.pathname path /C:/... not resolved by esbuild; backend/test files unchanged. CI Linux Cloud Sync Gate required before etest promotion; no all-green local claim.

## Deployment boundary and next steps

Push reviewed candidate to product/main after upstream recheck. Wait for identical SHA Cloud Sync Gate, deployed/published Pages regression, Etest Admission and Mobile P0 Gate. Promote only that candidate to edgeone-test, verify marker and repeated real mobile entry + contention/retry in a fresh browser context without creating accounts. master unchanged. A permanently frozen live owner still cannot safely be forcibly stolen; no universal force-takeover button is included. Huawei actual-device result remains to be confirmed by the user.
