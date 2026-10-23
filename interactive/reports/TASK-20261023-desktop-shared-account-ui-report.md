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


## Observed remote verification and handoff

Implementation SHA: e782627a3f5f5b377b8d369516a665f915cdcb66, pushed to product/main and promoted by fast-forward to edgeone-test only after its Cloud Sync (39892353899), Pages deployment/regression (39892353917), Etest Admission (39892353896) and Mobile P0 shared-account gate (39892353907) passed. S1 Workspace (39892353883) and P4b Browser Recovery (39892353757) also passed. Linux Cloud CI resolved the local platform-only test failure without changing tests.

Live https://t.smhe.cn/ verified source marker e782627, PC/phone same-tab account entry, registration policy, return to correct study route and real HTTP 401 account_not_found. No account was created by this interface-only smoke.

During verification the independent cloud executor advanced product/main and edgeone-test through aea7795e, 12d668ac and 2199c824 to 337af788e64c1e0faed11f35be03d262d7d31b8f. We fast-forwarded without conflict. Account presenter/controller/API/backend files and src/index.tsx are unchanged by those commits; the added pre-boot M4 work is owned by CURRENT_TASK. Did not rewind staging. The latest integrated SHA's Cloud (39893317599), Mobile P0 (39893317535), S1 Workspace (39893317591) and Pages (39893317530) passed.

Actual password change on 337af78: disposable fixture e2e_pc_mvkeilab_d14e79 registered (201), current-password change succeeded (200), new token kept immutable account identity, old password rejected (401 incorrect_password with specific UI hint), new password logged in successfully (200), server /auth/me confirmed identity. Only that verified fixture was deleted; login readback returned account_not_found. Temporary local test credentials were removed. Redacted evidence is interactive/evidence/TASK-20261023-desktop-account-live.json.

Live-test harness incidents were kept separate from application behavior: fixed the 201 registration assumption; avoided fetching CDP response bodies after navigation by checking persisted auth after successful navigation; awaited guarded startup before probes. A later probe rejected a moved source SHA before sending any auth request. One e782 password verification saw the generic auth fallback, while the final 337af verification captured the exact expected 401 code and passed. No blind registration/password-change/deletion retry was performed.

### Outstanding test-fixture cleanup

The FIRST script's incorrect 200-only capture left the unused staging account e2e_pc_mvke3zf7_178cb4 without retained credentials. Its presence was subsequently confirmed by HTTP 401 incorrect_password with a deliberately wrong synthetic password. No learning actions were performed. This account remains pending administrator cleanup; the current backend has neither password recovery nor an authorized admin-erasure endpoint available to this executor. Do not claim all fixtures were cleaned. Do not delete similar names or infer ownership of other accounts. Other created validation fixtures were deleted and read back as absent.

### Wider release checks are not a product-release claim

For e782627, real EdgeOne S1 browser accounts and real V4 transport both passed in run 39892904879, but its final release-readiness aggregator failed. Review Gate 39892354048 had one header alignment assertion (4.484375px difference vs <=4px); it was not weakened. The independent pre-existing three-device convergence scenario 39892905031 also timed out with one of three UUIDs visible; it was not converted to PASS or addressed by this account task. The cloud executor subsequently updated that path on 337af788. No full multi-device convergence or master-release qualification is asserted here. Master remains 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2.

Account UI implementation and staging acceptance checks are complete. User can review the PC login at https://t.smhe.cn/?s1-account=manage and phone login at https://t.smhe.cn/mobile/account. Six-month deletion remains policy text only, explicitly requested by owner with its implementation deferred.
