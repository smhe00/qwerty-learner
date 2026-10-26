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
