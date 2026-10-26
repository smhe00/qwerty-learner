# Minimal Circle UI report

Status: REVIEW. Executor: Codex-circle-ui.
Initial base: a82f9d95b1fb4c3dc24d77a4951d234fd43d9955.
Claim: 651dd04be11157909bc325749b198de47145f0d0.
Integrated development base: 3f2e2791b5dd3ff6d195bf30eec82c0ca38d22fe.
Implementation SHA: 44b278d1c231983a37d3818e7d4722f325e98e83 (all integrated local validation above applies to this source).
Workspace: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-circle-ui-minimal.

## Delivered
- PC Learn replaces only the disabled top-toolbar ErrorBook slot with Circle. Valid login enables it. Typing ErrorBook and footer WeChat/community are unchanged.
- Mobile home has a Circle menu row and a responsive single-column screen. Both direct routes have generated SPA entry files.
- Create, code join, own-circle list, saved invitation copy, seven-day views, explicit manual check-in, clap, leave, owner remove/close. Controls reflect three circles / fifty members; backend advisory policy remains unchanged.
- Same-origin authenticated client, expired-session/Pages guards, no automatic mutation replay, synchronous single-flight lock, stale-read abort and account identity checks.
- Creation retry UUID and exact inputs are saved before dispatch; invitation hints are account-scoped local UI storage. No auth/workspace/learning schema changes, learning record publishing, rankings or chat.
- Reused desktop auxiliary navigation retains and pauses the learning screen. Empty selection clears an aborted detail loading state.
- Integrated parallel feedback/account-deletion changes; resolved only Mobile icon imports, retaining both entries.

## Changed files
UI: src/circle/{client,useCircleAuth}.ts; src/components/CircleEntry.tsx; src/pages/Circle/{index.tsx,circle.css}.
Integration: src/app.tsx; src/components/NavigationOverlay.tsx; src/pages/Typing/components/Switcher/index.tsx; src/pages/Mobile/{index.tsx,mobile-app.css}; scripts/emit-edgeone-spa-entries.mjs.
Verification: tests/e2e/circle-ui*.ts; .github/workflows/circle-ui-gate.yml.
Documentation: task/current-task/report and docs/CIRCLE_MINIMAL_UI_20261026.md.

## Validation on integrated source, 2026-10-26
- Focused ESLint: PASS across all touched application TypeScript.
- yarn tsc --noEmit: exit 2 from pre-existing repository diagnostics. NO diagnostics in touched application files. This is a scoped audit, not a clean full-repository typecheck.
- yarn build: PASS, 43.26 s; both build/circles/index.html and build/mobile/circles/index.html exist. Existing dependency/chunk-size warnings remain.
- npx playwright test --config tests/e2e/circle-ui.config.ts: 8/8 PASS, 50.7 s, Chromium, one worker, no retries.
- npx playwright test --config tests/e2e/circle-ui-pages.config.ts: 1/1 PASS, 21.0 s.
- Cases cover PC placement/login/Typing/footer, retained background and identical wordRecords/reviewRecords/reviewWordStates, seven days, double-click one write, phone creation/reload/invite/check-in, 320/390 px and dark/no overflow, unknown creation same-ID recovery, join/leave, owner remove/close, Escape, expired/401 auth preservation, stale account response suppression, local storage failure before creation, legacy invitation explanation and Pages no-Circle/auth/sync requests.
- Existing Pages startup can probe public /api/health; only that endpoint is allowed by the boundary test.
- git diff --check and workflow YAML parse: PASS.
- Screenshots visually reviewed using synthetic fixture data. Copies/logs are outside the checkout at C:/Users/peter/Documents/Codex/2026-10-26/circle-ui-preview.
- Windows test execution sets NO_PROXY=127.0.0.1,localhost and distinct ports 51644 / 51645 to avoid system proxy health-probe interference.

## Evidence limits and handoff
All browser API responses are isolated fixtures; no live account writes or Cloud/Blob qualification. Desktop Chromium phone viewports do not certify a physical phone.
GitHub Pages deliberately disables Circle functionality. No staging/production promotion is authorized or performed.
Invitation codes are only available on browsers where created/joined; existing server API cannot recover them on another browser. Labels use member ID suffixes because the API exposes no display names. Manual check-in does not upload or alter learning records.
Future release requires repository exact-SHA staging/Pages/release gates and explicit owner authorization. Existing full typecheck baseline remains outside this task.
## Owner-authorized etest promotion, 2026-10-26
The owner explicitly requested etest deployment after UI completion. This supersedes the earlier no-staging scope; master remains excluded.
Preflight found Cloud Sync Gate run 40318007556 failing in login-event-warning.test.mjs after the merged self-deletion feature introduced a new browser dependency graph. The anonymous-login unit fixture now isolates mountSelfDeleteControls (rejecting non-anonymous use) and defines VITE_QWERTY_SYNC_DISABLED=false. All existing login assertions remain unchanged; self-deletion retains its dedicated browser suite. No application code was changed.
Validation: focused login-event-warning 9/9 PASS; yarn test:cloud 924/924 PASS (15.09 s); diff check PASS. Existing Circle browser/build evidence remains applicable to identical application source.
Before promotion: edgeone-test and master both 15fffa2c762037d8b29d1e5b953c729001ad5f0e, verified ancestors of the candidate. Development base 685f9fec598c74ea712e965c5dbd9d9d451b06ad. Promote the following test-fix commit by normal fast-forward only, then verify t.smhe.cn/source-commit.txt and public health. Record published verification in a follow-up evidence commit on development, without moving the pinned etest candidate.

### Published etest evidence
Pinned candidate: c8421d5996ef30af23b55d558c6455cfb562e13f. edgeone-test advanced normally from 15fffa2c762037d8b29d1e5b953c729001ad5f0e; master remained unchanged.
On 2026-10-26, t.smhe.cn/source-commit.txt returned c8421d5 and /api/health returned ok=true, service=qwerty-sync-gateway. Fresh Chromium read-only smoke PASS: PC Learn Circle entry disabled logged out; /circles displays login; 390px mobile menu disabled logged out; /mobile/circles displays login. No accounts were created by this smoke.
Exact candidate Cloud Sync Gate 40319195390: cloud contracts, sync lint, build and Pages/staging admission PASS. Branch Cloud E2E 40319232616 verified deployed source, but real-v4-transport failed: stale revision CAS expected 409, received 503 snapshot_body_read_failed. Disposable account cleanup PASS in both cases. No ambiguous operation was manually replayed. Other browser qualifications were still running at handoff. This deployment is NOT a successful production release qualification.
Deployment workspace: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-circle-etest-promotion (clean detached candidate plus this evidence commit). The earlier UI workspace retains formatter side effects after an interrupted repository-wide prettier command; they were NOT copied, committed or deployed. Automatic review rejected bulk restoration, so a clean worktree was used and only the three intended test/task/report files copied. Do not push unrelated changes from the earlier workspace.
This documentation commit advances development only; keep etest pinned to the candidate above.

## Creation failure and compact UI repair
Owner reported PC creation of hh staying pending. Live pre-fix etest probe: disposable registration 201, mine 200 empty, deliberately invalid blank-name creation unexpectedly 500 circle_internal_error (instead of domain validation), disposable deletion 200 confirmed. No Circle objects were created by that diagnostic.
Circle transport directly assumed request.body.getReader(), unlike the deployed gateway native arrayBuffer receiver. It now accepts the trusted gateway readBody callback only after route/auth/rate checks, reuses the gateway bounded native receiver, and preserves strict content type/object/allowed-field validation. Offline streaming tests retain their bounded reader. No body clone, second read or automatic mutation retry.
UI: single-column card layout; compact auto-height PC overlay; removed duplicate empty detail card; restored pending creation form after reload; explicit in-form server error and submitting state; continuation uses the saved original UUID and name. PC toolbar location, Typing ErrorBook and footer remain unchanged.
Validation: receiver/gateway suite 18/18 PASS; other Circle contracts 85/85 PASS; complete cloud contracts 925/925 PASS; UI 9/9 PASS, including failed hh creation/reload/same-input continuation and narrow container; final compact PC overlay 2/2 PASS; scoped UI lint PASS; final build PASS (32.47s). Screenshots inspected. No claim of live creation success until post-deployment verification below.
Working directory: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-circle-create-fix, clean source base 33011a55. Dependencies reuse existing installation by local junction; no dependency changes.

### Native receiver timing follow-up
ac6777a4 deployed and passed Cloud Sync Gate 40322195733. Real PC browser registration succeeded, but Circle creation returned 503 request_body_unavailable after 1983ms; the unused synthetic account was deleted successfully. This disproved that simply swapping the receiver at the late transport layer was sufficient.
The ordinary etest request passes an asynchronous account lookup in withHandoffGateway, then Circle authentication and rate lookups, before late body receipt. The handler now starts the bounded Circle JSON receive at onRequest entry, before any of those awaits, retains the one promise including rejection, and consumes it only after Circle authorization. No second body read or mutation retry. A full-handler fixture whose native body expires at the first store lookup verifies exactly one read, successful creation, and no social writes for unauthenticated or forged-field requests. Other routes retain their previous receiver.

Final receiver validation: full cloud contracts 926/926 PASS (14.66s); focused gateway lint PASS. Integrated unrelated feedback UI development through 6fef4400 without conflicts; no feedback files changed by this task.
Integrated production build PASS (28.28s).

### Final real creation acceptance: PASS
Pinned etest candidate db85edc7dbe796584ec4b0b3e38920ac7515db70; t.smhe.cn marker db85edc verified. Cloud Sync Gate 40323761696 PASS.
Fresh real Chromium PC browser (1280x900), no existing user profile: register a disposable ordinary account using the real account UI, open /learn, click Circle toolbar icon, fill hh, submit once. POST /api/circle/v2 returned 202 in 16282ms. Subsequent mine and detail GETs returned 200; hh was visible in both the circle list and detail heading. No request mocking, local auth injection, automatic retry or real user data. Screenshot: C:/Users/peter/Documents/Codex/2026-10-26/circle-ui-preview/circle-live-created.png.
The synthetic Circle was then closed successfully (202). The synthetic account remains subject to the existing social-data deletion hold; no erasure bypass was attempted. Fixture account ID 32491b1c3842c49038ab84e98c2b41f4; closed Circle ID 234b118433a569e5f3c3db0b. Credentials were kept only in the browser test process, never logged or committed. Earlier diagnostic/failed-creation accounts were deleted successfully.
The real creation acceptance supersedes the previous mock-only qualification for this specific creation/list/detail flow. It does not certify every social operation or physical devices, and does not remove the separate V4 production release qualification requirements. master remains 15fffa2c762037d8b29d1e5b953c729001ad5f0e.
Owner recovery: refresh etest, retain browser storage and saved name/UUID, then use Continue creation once. No logout, data clearing or renamed duplicate creation is required.
Task status REVIEW; development-only evidence commit follows the pinned etest candidate.
