# Mobile account writer handoff

2026-10-23 Asia/Shanghai. PARTIAL: scoped change deployed and verified; Huawei persistent occupation remains unresolved. Base 09383bdb306494d8d3a0788c7e77261881a50485. CURRENT_TASK remains owned by the independent cloud-convergence executor. No Huawei real-device reproduction or confirmed root cause claimed.

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


## Actual deployment and exact-SHA evidence

Source / deployed staging candidate: 0a7054e8776dc30d6c4fbc92e499cf441e8fac31 (0a7054e8). Confirmed all identical-SHA prerequisites before normal FF push from c187c73e to edgeone-test:

- Cloud Sync Gate 39868174726 SUCCESS (Linux backend contracts/build and exact Pages admission).
- Deployment to GitHub Pages 39868174987 SUCCESS, including actual deployment, live SHA propagation and published browser regression.
- Etest Pilot Admission 39868174972 SUCCESS.
- Mobile P0 Gate 39868174738 SUCCESS, including all 17 account tests and Pages preview.
- P4b Browser Recovery Release Gate 39868174624 SUCCESS.

Live etest marker initially remained c187c73 after push; no premature deployment claim. Marker subsequently changed to 0a7054e, verified before testing. Fresh isolated Chrome phone contexts, no existing user profile/accounts: 4 home-to-account activations in each of native and fallback modes (8 total), one visible tab, repeated return, persistent second-tab exclusion, same-document safe retry after first owner closes, and account refresh all PASS. Auth requests=0; no accounts created or changed. Started 2026-10-22T23:08:34.463Z, finished 23:08:59.683Z (2026-10-23 Asia/Shanghai). Machine evidence: interactive/reports/evidence/TASK-20261023-mobile-account-writer-live.json. This verifies simulated Chrome modes, not Huawei firmware/browser behavior.

## Full CI limitations (do not describe all gates as green)

- S1 Workspace Browser Gate 39868174832 FAILED: 104 pass / 5 fail. All five wait 120s for old tab name 数据设置 in workspace-v4-app.spec.ts. Current UI uses 数据与备份. git diff base..candidate is empty for both that settings UI and those tests; static selector mismatch is pre-existing. No assertion changed or gate bypassed. Other 104 cases including native/fallback writer compatibility and pagehide pass in CI.
- Review Gate 39868174658 FAILED: 114 pass / 2 fail. Learn extra-words case waits for enabled Start Learn; desktop alignment difference 4.484375 exceeds <=4. Neither corresponding source/test changed in this patch. Causality/baseline reproduction of those two failures has not been established; do not label them fixed or simply flaky.
- Staging Safe V4 Merge Writeback 39869338870 SUCCESS. Other live cloud/multi-device pilots may still wait for unrelated backend capability; no full multi-device certification follows.

## Corrected user evidence / remaining work

User initially replied that direct entry worked, then explicitly corrected it: entering /mobile/account in the same Huawei tab ALSO remains blocked. The successful-direct-entry observation is withdrawn. Do not infer that Huawei new-tab policy caused this incident. Current scoped change can address a transient release/new-context race, but is not evidence that this persistent device issue is solved.

Awaiting user result after fully exiting/reopening Huawei browser without clearing site data. If persistent on current source, next work must capture native lock availability/held lock state, lease kind/expiry/heartbeat and same-tab ownership diagnostics from the actual device before changing ownership policy. A safe cooperative handoff requires old writers to stop before ownership transfer; no blindly forced native steal or IDB lease override. The original app's pending-writer/pagehide safety remains intact.

Remote master checked unchanged at 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2. This report/evidence completion is committed to product/main without another etest rebuild; application source matches the staging candidate.


## Iteration 2: actual Huawei persistence and read-only diagnostics

User confirmed deployed 0a7054e8 behavior after exiting/reopening: home login shows Preparing Local Data, then the new Busy title. Therefore iteration 1 does NOT solve this persistent Huawei case. User also reports Google mobile Chrome works normally. This narrows browser/profile specificity, without proving an engine defect or excluding old retained contexts/site-local state.

- Ordinary account activation now uses location.replace rather than assign: it replaces the current home history entry rather than intentionally preserving it. Explicit account Back still returns home. A retained-context explanation remains a hypothesis, not a Huawei-device reproduction.
- Busy panel offers Copy Diagnostics, sampling native lock support/held/pending counts and lease kind/remaining lifetime/same-session-token match twice 2.5s apart (longer than the 2-second renewal interval). Includes app version, UA and pathname only. No raw owner/instance/client IDs, authentication state, learning data or cloud API calls.
- Clipboard denial falls back to an explicitly read-only selected textarea. The inspector reads only the writer-lease DB in readonly transactions. It aborts an upgrade if the DB is missing, proving no new lease database is left behind. Reads and native-query failure waits are bounded; no ownership changes or clearing.
- Added source module src/sync/workspace-lock-diagnostics.ts; Mobile P0 CI now watches/types/lints the lock/bootstrap/diagnostic files explicitly.
- Local phone suite 18/18 PASS (68.49s), including no additional history entry and native/fallback metadata reads with no learning-table transactions. Clipboard-denial addition separately PASS 1/1 (18.26s). Pages build and preview 3/3 PASS (7.97s). Normal build PASS (34.17s), lint 0 errors / 120 existing warnings, changed-file TS clean with unrelated repository baseline failures retained, architecture PASS. Workflow YAML parses.
- Same-SHA Cloud/Pages/Admission/Mobile prerequisites will be checked before promoting this iteration. No force takeover or early pagehide release. Actual Huawei result still requires device retry and, if busy, copied metadata. Preserve all data in both browsers; local records are browser-specific.


Iteration-2 follow-up: diagnostic samples are 2.5 seconds apart to span the 2-second renewal interval. Both native and fallback persistent-owner cases verify the sampled expiry actually advances for a live owner; clipboard fallback remains covered. Focused changed cases 2/2 PASS (28.61s). a44a4673 is an intermediate development candidate, not promoted to etest; promote only the follow-up exact SHA after prerequisites, avoiding an unnecessary Maker build.
