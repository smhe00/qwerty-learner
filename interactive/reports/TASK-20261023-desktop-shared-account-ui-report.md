# Shared PC/phone account interface

2026-10-23 Asia/Shanghai. Base and upstream at intake: eb40fd6a299fb70fd69f73c06a64245e38989308. Independent UI/auth task authorized directly by owner; CURRENT_TASK cloud convergence remains owned elsewhere.

## Result

- PC reuses the phone pre-mount account presenter: login/register tabs, required labelled inputs, password visibility, native keyboard submission, localized errors, account state and safe logout. Desktop uses a centered 480px card with username focus; phone keeps heading focus and its existing responsive layout. Dark/light themes share styles.
- PC header uses same-tab `location.replace`, with deployment basename. Desktop and phone return to their own study routes. Read-only legacy Pages account previews never import auth/transition handlers or migrate records.
- Registration shows recovery/reset unsupported, signed-in password change available, and the owner-requested six-month inactivity deletion notice. Owner explicitly deferred cleanup implementation. No inactivity tracking, scheduled deletion, or real account cleanup was implemented or activated.
- Signed-in users can change passwords using the existing current-password API. New-password confirmation and native length validation precede submission. The returned token uses existing same-owner S1 reauthentication, preserving owner/generation and learning data. Expired sessions must reauthenticate first. Unknown network/server outcomes advise checking with the new password rather than claiming no mutation occurred.
- Login errors now distinguish HTTP 401 `account_not_found` (missing/inactive account) from `incorrect_password` (existing account, wrong password). UI retains the generic older-gateway fallback. Current-password errors for password changes/deletion remain `invalid_credentials`.
- Updated browser interactions in existing S1, revoked-session and staging multi-device tests; persisted-data assertions are unchanged. New desktop/password/Pages coverage is included in Mobile P0 CI.

## Local validation

- Shared account/writer suite: 26/26 PASS before the final distinct-login-code addition. Final targeted PC/phone password + distinct-login-error suite: 6/6 PASS, including both added error-code cases.
- Pages production build + desktop/phone cloud-disabled preview: 4/4 PASS, including legacy records/auth retained without migration or requests.
- Revoked-session UI safety: 4/4 PASS, including same-owner reauthentication and offline record retention.
- Backend account contract: 14/14 PASS (includes backend self-test, password changes, wrong/missing login, and failed-login session retention).
- Full local cloud suite: 523 PASS / 1 FAIL out of 524. The failure is the existing Windows `/C:/...` URL.pathname/esbuild resolution in `s2-write-route.test.mjs`; no assertion was weakened or skipped. Linux Cloud Sync CI must pass before staging.
- Full lint: 0 errors / 120 pre-existing warnings. Architecture boundary validator PASS. Normal and Pages builds PASS (existing bundle-size warning).
- Full TypeScript retains 139 repository baseline errors, including existing `src/sync/api.ts:61` ES5 iterable diagnostic verified against base. Shared account presenter/controller, Header and entry changes add no diagnostics.
- Original 51-test workspace app/lock run: 40 PASS / 11 FAIL; all failures were 5-second local Vite cold-load/poll timeouts. Original traces retained in `.review-test/desktop-compat-results`. Recheck only those 11 using ignored local config `expect.timeout=30s`, without changing committed assertions: 11/11 PASS (62.19s).
- Screenshots inspected: PC registration and password-change forms; native keyboard focus is visible and registration notice remains above submit. Phone light/dark screenshots retained.

## Branch and deployment boundary

No production release. Master was verified at 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2. Staging at intake is eb40fd6a on https://t.smhe.cn/, independently checked with ls-remote (the local origin/edgeone-test ref is stale).

This report is committed with the implementation; obtain its exact implementation SHA via `git log -1 --format=%H -- src/sync/workspace-account-ui.ts`. Before etest promotion require this exact SHA's Cloud Sync, Pages published regression, staging admission and shared account gate. No real-user credentials or fixture accounts were created/modified manually during local verification. Remote CI/deployment evidence remains pending until observed; do not infer it from local passes.
