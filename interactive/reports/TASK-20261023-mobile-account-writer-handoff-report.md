# Mobile account writer handoff

2026-10-23 Asia/Shanghai. REVIEW: deployed mobile login entry confirmed normal by the Huawei user; exact browser lifecycle cause remains unproven. Base 09383bdb306494d8d3a0788c7e77261881a50485. CURRENT_TASK remains owned by the independent cloud-convergence executor. No Huawei real-device reproduction or confirmed root cause claimed.

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


## Iteration 2 actual deployment / final checkpoint

Final source and stage SHA: f8d4f5877252040f4bad1a7e8fdb739a58ef36e9. The intermediate a44a4673 was not separately deployed. Matching-SHA prerequisites all SUCCESS before normal FF to etest:

- Cloud Sync Gate 39871183968, including cloud-backend job 120145743247 and Exact-SHA Pages + Cloud Staging Admission job 120146161238. Standalone Etest Admission workflow did not trigger on the final index/tests-only follow-up; the identical admission script ran successfully inside Cloud Gate, validating current main and live published source SHA.
- Deployment to GitHub Pages 39871184065, including actual deployment and published regression.
- Mobile P0 Gate 39871184070, including current 18 account/writer cases and cloud-disabled Pages preview.
- P4b Browser Recovery Gate 39871184053 SUCCESS.

Waited for actual staging marker to change from 0a7054e to f8d4f58; no premature availability claim. Fresh isolated native/fallback Chrome phone contexts then PASS: 4 home-account entries each, same tab and unchanged history count, persistent second-tab exclusion, 2-sample diagnostic copy from actual lazy-loaded staging module, retry only after owner exits with document identity preserved, and account refresh. Auth requests=0, no test accounts created by this targeted browser procedure. Machine proof: interactive/reports/evidence/TASK-20261023-mobile-account-writer-v2-live.json. UTC execution 2026-10-22T23:33:58.881Z..23:37:00.883Z includes deployment wait; Asia/Shanghai date 2026-10-23. Actual Huawei confirmation is still pending and is not replaced by these simulated-mode results.

### Other current gates / unresolved CI

- S1 Workspace Browser Gate 39871183962 FAILED, 104 pass / 5 fail, all same pre-existing 数据设置 selectors waiting for UI now labelled 数据与备份; those test/UI files are unchanged by both iterations.
- Review Gate 39871183951 FAILED, 114 pass / 2 fail: extra-words Start disabled and Learn/Typing header difference 4.484375 >4, same observations as iteration 1. Corresponding logic/tests unchanged; no claim of baseline reproduction or root-cause fix for these two failures.
- Staging Safe V4 Merge Writeback 39872599923 FAILED. The actual CAS, chronological six-table/FSRS replay, stale-409 and independent readback assertions logged PASS, but final disposable-account ownership re-verification encountered login HTTP 429 after earlier transient 500 responses; cleanup refused with `Disposable cleanup account ownership not reverified`. A test-created account may remain; its cleanup is UNVERIFIED. Do not blindly rerun mutating pilot or delete any account without re-verifying exact fixture ownership. No credentials were retrieved/exposed and no manual deletion attempted by this task. This is separate from the local writer UI symptom, which occurs before auth requests.
- Other M1/M3/three-device/live E2E gates may remain pending/backend-gated; this work does not certify whole cloud convergence or a master release.

### User follow-up needed

User confirmed Google mobile Chrome is normal while Huawei on 0a7054e8 remains blocked after exit/reopen. Latest request: in Huawei current tab open /mobile?writer-check=f8d4f587 and tap login; if blocked, copy diagnostics and paste into chat, or report normal. Diagnosis can then use native held-count, lease kind/expiry progression, same-session token match and actual browser/version. Preserve Huawei site data; no force steal. Status PARTIAL while actual-device outcome is pending. master remains 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2. Final report/evidence-only commit goes to product/main without another Maker deployment; app source stays identical to tested staging f8d4f587.


## Huawei real-device acceptance, 2026-10-23 Asia/Shanghai

User replied exactly 已正常 to the current-tab /mobile?writer-check=f8d4f587 Huawei home -> Login test request. This supersedes the pending-device state above: the reported login-entry occupation symptom is user-confirmed resolved at deployed f8d4f5877252040f4bad1a7e8fdb739a58ef36e9. No raw device diagnostics or personal learning data were collected. This is user-reported acceptance, distinct from an independently proven browser-internal cause. No force-steal was required. Task status REVIEW; unrelated CI failures and full-release boundaries remain unchanged.

Development main independently advanced after 9a2e4b1c with cloud/session and fixture-cleanup work (including 87d4bbbb); integrated only via ff-only pull. This documentation update neither certifies nor deploys those independent source changes. It does not advance etest or master. Note: this checkout tracks only product/main in remote.origin.fetch; verify edgeone-test using ls-remote rather than its stale local remote-tracking ref.
