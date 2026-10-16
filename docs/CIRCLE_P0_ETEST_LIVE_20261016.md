# Circle P0 — etest real-world admission verification (2026-10-16)

**Status: BLOCKED AT SERVER CONFIG; no authorized Circle writes performed.**
**Target:** https://etest.edgeone.dev — no production or master mutation.

## Live EdgeOne site check

GitHub Actions [P0 HTTP live probe](https://github.com/smhe00/qwerty-learner/actions/runs/38853643961) executed against the actual etest deployment, not a local mock:

| Check | Observed |
|---|---|
| GitHub staging HEAD | `7358cb099a9546cae0de44808b987aed0f1f04af` |
| Online source marker | `7358cb0` (valid prefix match) |
| GET `/api/health` | 200 `qwerty-sync-gateway` |
| V4 binary capabilities | advertised |
| GET `/api/circle/v2` without bearer | 404 `not_found` |
| Account creation / Circle Blob mutations | NONE |

The check intentionally fails rather than presenting a blocked API as a
successful Circle E2E.

## EdgeOne Maker configuration metadata audit

Using the existing `EDGEONE_API_TOKEN` secret and official
`@edgeone/makers-sdk`, a second [read-only environment audit](https://github.com/smhe00/qwerty-learner/actions/runs/38853823894)
identified the **exact** Maker project bound to `etest.edgeone.dev`.
It checked **variable keys only** (no values logged or modified):

| Key | Present on etest Maker |
|---|---|
| `CIRCLE_ETEST_ENABLED` | NO |
| `CIRCLE_ETEST_BLOB_STORE` | NO |
| `CIRCLE_ETEST_INVITE_KEY` | NO |
| `CIRCLE_ETEST_USER_IDS` | NO |

The code deliberately requires ALL four fields and refuses access otherwise.
An absent `CIRCLE_ETEST_ENABLED=true` returns 404, before any Circle event
read or write. Enabling the variable requires a **new Maker deployment**,
according to EdgeOne's environment-management documentation. Do not create
an automatic deployment merely to test without a known cleanup/identity
lifecycle and authorization checks.

## Required etest-only configuration and handling

1. `CIRCLE_ETEST_ENABLED=true`
2. `CIRCLE_ETEST_BLOB_STORE=qwerty-circle-sandbox`
3. `CIRCLE_ETEST_INVITE_KEY`: dedicated securely generated server-only secret, at least 32 chars, never checked into Git or printed in CI
4. `CIRCLE_ETEST_USER_IDS`: 1–16 immutable V4 user IDs of dedicated staging test accounts; NEVER public usernames, unknown accounts, or production identities

**Account cleanup caveat:** current etest pilot blocks deletion of any user
on this allowlist even if the flag is subsequently disabled, until audited
Circle event removal has been implemented. The on-test Blob objects are
identity-bearing. A safe account/event deletion plan is required before
creating new Circle test accounts or claiming cleanup complete.

## Pending P0 verification once enabled and redeployed

- Check exact deployed staging source SHA and `/api/health`
- GET Circle without a bearer -> 401 (not 404)
- Invalid/revoked sessions -> 401
- Test accounts not on allowlist -> 403
- Owner creates -> member joins -> progress -> achievement -> clap
- Owner removal -> eventual remove-wins, absence of unauthorized content
- Owner closure -> eventual close-wins and no further social visibility
- Unique event keys/no CAS; no access to backup `qwerty-data`
- Independently verify physical event scrub and test-account teardown

**Current result:** P0 NOT PASSED; deployment/environment is the blocker,
NOT Base64 or the previously unit-tested Circle event model.

No etest branch push, Maker build, production access, or token disclosure
was performed by these two read-only CI workflows.
