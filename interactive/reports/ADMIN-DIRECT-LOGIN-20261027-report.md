# Admin direct login and idle protection

Status: REVIEW. Local implementation complete; not deployed to etest/master.
Executor: Codex-admin-direct-login. Isolated worktree: C:/Users/peter/Documents/Codex/2026-10-27/qwerty-admin-direct-login.
Application commit: 4dcadb8a9220b7ee3a550c46299aca62f649d0e6.
Initial base: 1bd2c356b46616bf36ee94a8e794914f2ffd780b.
Integrated upstream: c407dbbf27fa67a2cf9cde1c4ec931e651a53e3f (Circle acceptance documents only; no runtime overlap).
The Circle CURRENT_TASK was preserved.

## Behavior and identity

Public administrator name is admin. The existing login form accepts the server-configured ADMIN_PASSWORD and initializes the identity on first successful login, without registration. Both reserved names reject public registration with a direct-login message; smhe login also points to admin. No built-in fallback password remains; absent, empty, invalid or lower-case admin_password configuration cannot enable administrator login. Environment changes require a new deployment, which can use the same source commit.

The canonical legacy smhe hash, immutable user ID, binding key and session namespace remain in use internally. Existing learning, feedback and identity records are retained rather than copied. Public user profiles return admin. Password rotation/removal invalidates administrator sessions; old ordinary passwords/sessions cannot enroll the administrator. Bound missing/replaced identities and ordinary admin name collisions fail closed. The latter needs an explicit operator recovery decision and never silently promotes or overwrites that account. Read-only preflight does not initialize anything. Missing configuration does not disable normal users or their policy processing.

Administrator self-delete and application password changes remain denied. Idle cleanup explicitly exempts the configured immutable ID plus both admin and legacy smhe names, even without password configuration or a binding. Exemption is independent of authorization; names alone do not grant admin permissions. Repeated cleanup beyond 180 days and stale deletion markers cannot delete their account/session, learning or feedback namespaces. Normal expired users still drain and delete.

Changed runtime: administrator.js (configured login alias), core.js (private first-login initializer), idle-accounts.js (name/ID protection), workspace-account-ui.ts (concise error copy). Updated operational documentation and .env.example. Existing auth/idle/feedback tests were adjusted to direct login, and administrator-login.test.mjs adds security and destructive-cleanup contracts.

## Validation

- Full local Cloud suite: 948/948 PASS, 16.42s. Includes actual bundled HTTP gateway with synthetic Blob stores for login, admin access and private feedback reply/status authorization. Not real EdgeOne/Blob evidence.
- New administrator contracts: 14/14 PASS within that suite. Cover wrong/missing config with zero identity/binding writes, first login, stable legacy ID/data, rotation/revocation, self-delete denial, collision protection, missing/replaced binding, confirmed lost identity/binding receipts, unconfirmed binding followed by explicit login, concurrent initializers with conditional-write fixture, read-only preflight, transient metadata reads, repeated cleanup at 400/600/800 days, and ordinary expiry alongside admin.
- Chrome PC/phone account/password file: six existing tests PASS. Two new administrator error/corrective-registration-hint tests initially failed because the driver dismissed the existing native registration confirmation. Added explicit fixture confirmation handling; both reran PASS (9.4s). Total eight cases covered, with no runtime safety check or assertion weakened. Local API interception only, no real admin credentials or live accounts used.
- Scoped ESLint PASS for changed JS/TS files. Fixed import ordering/unused import; browser test lint explicitly uses the TS parser because repository overrides do not cover tests/e2e. No repository-wide TypeScript cleanliness claim.
- Production build PASS, 28.55s Vite / 30.23s total. Existing Browserslist, dependency use-client and chunk-size warnings retained.
- git diff --check PASS.

Initial focused Cloud run was 44/45 because an automated test edit accidentally changed an ordinary registration expected status from 201 to 200. Restored that ordinary-user expectation; the subsequent full 948-test run passed. Final import/comment-only changes do not alter runtime behavior. Upstream integration changed only independent Circle documentation.

Local raw logs: blob-report/admin-direct-login/{cloud,lint,lint-browser,build,browser,browser-admin}.log (ignored). Browser failure traces remain local. No secrets, tokens or user learning backups are committed.

## Remaining boundary

This is product/main development, not a release qualification. etest/master remain untouched. Real feedback acceptance from FEEDBACK-LIVE-ACCEPTANCE-20261027 stays paused at the owner's request, awaiting human administrator setup/login. Do not obtain administrator credentials from source/environment or resume that live test implicitly. Future authorized etest deployment must use correct uppercase ADMIN_PASSWORD, and requires fresh same-SHA live acceptance; historical feedback runs must not be mixed. Provider onlyIfNew is not claimed as global CAS: real nonproduction concurrent initialization/receipt-loss qualification is still needed before production promotion. Never delete the persistent administrator binding to reset a password.
