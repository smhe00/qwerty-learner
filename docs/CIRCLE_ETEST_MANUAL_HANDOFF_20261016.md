# Circle — exact manual boundary (2026-10-16)

Status: **code and no-credential validation complete; an etest-only operator action is now required**. No production or Maker changes were made by this work.

## Verified state

- Current etest Git HEAD: `8c9078c2305423c64726bed59365a11738976b65` at the time of the verification.
- No-credential live probe [Circle etest read-only preflight #38797151353](https://github.com/smhe00/qwerty-learner/actions/runs/38797151353): `/api/health` healthy, source marker `8c9078c` matching deployed HEAD, unauthenticated `POST /api/circle/v2` returned **404**; no body, bearer token or Circle writes were sent. This means Circle is off or the route is not mounted; it is not an authenticated API pass.
- Offline Circle kernel, transport, etest gateway and opt-in journey test [Circle Core Gate #38797000465](https://github.com/smhe00/qwerty-learner/actions/runs/38797000465): Circle **104/104** and existing Cloud V4 **59/59** passed; lint and frontend build passed. Later replay additions still require checking the final HEAD CI.
- Isolated SDK Blob event replay [#38795700711](https://github.com/smhe00/qwerty-learner/actions/runs/38795700711): 15/15 objects cleaned up, 15-event serial/parallel replay equivalent, eventual remove/close converged. This only qualifies the SDK sandbox, **not** the etest Cloud Functions binding or real V4 sessions.

## Operator-only prerequisite: etest Maker Cloud Functions settings

All configuration is for **etest.edgeone.dev only**. Do not enable Circle on `q.smhe.cn`, `master`, or the production EdgeOne project.

1. Prepare **two disposable etest V4 accounts**, each with its own current authenticated session. Capture each **immutable user ID** from an authenticated `GET https://etest.edgeone.dev/api/auth/me` response; do not use usernames. Existing personal accounts and learning progress must not be used.
2. Confirm the **etest** Maker Cloud Function can reach a separate Blob Store named exactly `qwerty-circle-sandbox`; the normal V4 `qwerty-data` Store must remain isolated.
3. In the **etest project's server-only environment**, configure:
   - `CIRCLE_ETEST_BLOB_STORE=qwerty-circle-sandbox`
   - `CIRCLE_ETEST_INVITE_KEY` = a private random secret of at least 32 characters (do not send it in chat or commit it)
   - `CIRCLE_ETEST_USER_IDS` = the two immutable disposable IDs separated by commas (up to 16 are supported)
   - `CIRCLE_ETEST_ENABLED=true`
4. Ensure the etest deployed source marker still matches the intended `edgeone-test` commit, and the application-only `/api/health` works. Config changes/redeploys are **operator-managed** because they may consume Maker build quota.

When activated and correctly configured, unauthenticated POST to `/api/circle/v2` is expected to return HTTP **401** (not 404, not 503). This no-auth request must never create a circle.

## Automated staged proof after operator setup

The script `scripts/circle-etest-live-journey.mjs` has two modes:

- `node scripts/circle-etest-live-journey.mjs --preflight`: safe, no credentials, reads `/api/health` and `/source-commit.txt`, and sends one **body-free unauthenticated POST**; does **not** write Circle events.
- `node scripts/circle-etest-live-journey.mjs --run`: requires **all** of these environment variables, validated before any network request:
  - `EXPECTED_ETEST_SHA` = exact 40-character deployed `edgeone-test` Git SHA
  - `CIRCLE_LIVE_ACK=RUN_ISOLATED_ETEST_CIRCLE_ONLY`
  - `CIRCLE_DISPOSABLE_ACCOUNTS_ACK=I_ACCEPT_TEST_ACCOUNT_RETENTION_GUARD`
  - `CIRCLE_OWNER_USER_ID` / `CIRCLE_MEMBER_USER_ID` = distinct immutable disposable account IDs
  - `CIRCLE_OWNER_TOKEN` / `CIRCLE_MEMBER_TOKEN` = distinct **current** etest Bearer session tokens stored only in a local/private environment

**Do not put bearer tokens in shell command arguments, URL query strings, GitHub commit files, CI logs, or this chat.** Use local environment variables or an approved private secret manager. In particular, two separate browser accounts may need independent profiles to prevent token invalidation from the single-active-session policy.

The live test checks the source SHA and both session-ID bindings **before** any Circle write; then it executes:

`create → confirm creation visible → invite join → progress → clap → owner removes member → removed member receives 403 → close → owner receives 410`

Writes are 202/pending and polls allow the normal eventual-consistency propagation delay. The workflow does not claim immediate revocation or physical erasure.

**IMPORTANT: Test objects are deliberately NOT auto-deleted.** Circle data are retained after closure. The allowlisted accounts MUST remain dedicated and protected from deletion until a separately validated physical scrub/residual audit is complete. Do not remove the allowlist to bypass the deletion guard; do not delete the sandbox Store. A rejected/failed write may still have committed, so a failed journey likewise requires manual inventory. Successful Circle E2E does not certify account-deletion GA.

## Decision boundary

Once the preflight reports `enabled_auth_required` (401), run the opt-in journey with disposable accounts in the authorized environment. Share **only the output status, Circle ID if needed, deployment SHA and sanitized failure code** for subsequent troubleshooting. Never share tokens, invitation secrets or passwords.

Remaining general-availability gates: retention/privacy and retryable erasure protocol, Circle front-end and usability, abuse/rate-control review and load/replay scalability. Do not open Circle on the production site as part of this pilot.
