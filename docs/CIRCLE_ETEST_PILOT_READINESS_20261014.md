# Circle — etest staging admission, 2026-10-14

**Status: CODE-READY FOR A CONTROLLED ETEST PILOT, NOT DEPLOYED.**
**Scope:** API-only, test-account allowlist, eventually consistent EdgeOne Blob;
no Circle frontend, no master/production release, no physical-erasure GA claim.

## Non-negotiable isolation

- Candidate branch: `feature/circle-etest-ready`, created directly from the
  then-current `edgeone-test`/ `product/main` SHA
  `85c9cbb254cea8de56d0022da1f73af542a38cbf`.
- The integration adds only Circle modules, tests and documentation, plus
  a minimal `cloud-functions/api/[[default]].js` adapter. The latest
  V4 HTTP multipart, M3 multi-device, session logic, frontend and existing
  storage adapter remain untouched.
- Production `qwerty-plus.edgeone.dev` and any non-etest host ALWAYS
  return HTTP 404 for `/api/circle/v2/**`, regardless of environment.
- On etest, the Circle route is OFF by default and responds 404 until
  `CIRCLE_ETEST_ENABLED=true` in the dedicated etest Maker project.
- After activation, the Blob Store name must exactly equal
  `qwerty-circle-sandbox`; NEVER `qwerty-data`. API writes remain
  server-only under `social/v2/circles/<id>/events/<eventId>.json` with
  fresh unique physical keys and no CAS/onlyIfNew.
- Existing QWERTY V4 account sessions are checked on each Circle action.
  Only immutable V4 account IDs explicitly allowlisted for this pilot
  can call Circle; the code never trusts user IDs in request payloads.
- Trusted `context.clientIp` (not a client-provided HTTP header) and
  hashed account ID drive the bounded existing best-effort IP/account rate
  limiter. This is NOT a strongly consistent global quota.

## Required etest-only environment variables

Configure in the **etest Maker project's Cloud Functions environment**, not
in GitHub, not in the production Maker project and not in a frontend build:

| Name | Safe requirement |
| --- | --- |
| `CIRCLE_ETEST_ENABLED` | `true` ONLY when authorized for pilot |
| `CIRCLE_ETEST_BLOB_STORE` | exactly `qwerty-circle-sandbox` |
| `CIRCLE_ETEST_INVITE_KEY` | private random 32+ character server secret; do NOT commit/share |
| `CIRCLE_ETEST_USER_IDS` | 1–16 comma-separated immutable account IDs from verified etest `/api/auth/me`, not usernames; disposable test accounts ONLY |

The etest Maker project must have the Circle sandbox Blob Store available
and independent of its existing V4 Store, as well as the expected trusted
`context.clientIp`. The earlier external API-token Blob live test does
NOT establish that this embedded Makers Cloud Function can access the
isolated Store; this is the primary post-deploy smoke check.

Missing/invalid config is an intentional fail-closed HTTP 503
`circle_etest_not_configured` after explicit feature activation.

## Account deletion safeguard

Deleting an etest account ID on `CIRCLE_ETEST_USER_IDS` returns HTTP 409
`circle_etest_deletion_requires_cleanup`. **The restriction remains even
when `CIRCLE_ETEST_ENABLED` is subsequently changed to false.**

Why: before an account is deleted, any identity-bearing Circle event needs
repeatable physical cleanup and residual audits in a non-atomic,
eventually consistent storage system. That lifecycle is NOT ready. The
pilot must not claim `accountDeleted=true` while social events remain.

**Operational restriction:** do not remove test account IDs from the
allowlist or deprovision the sandbox Store until all corresponding Circle
events are scrubbed and independently audited. Test accounts must be
dedicated and non-production. This restriction is temporary pilot scope,
**not an acceptable general-availability account-deletion solution**.

## API / experience

Base URL: `https://etest.edgeone.dev/api/circle/v2`.
Existing API is a JSON/Bearer-token HTTP contract:

| Operation | HTTP |
| --- | --- |
| Create circle | `POST /api/circle/v2`: `name`, stable `operationId` |
| Join with secret invitation | `POST /api/circle/v2/join`: `inviteCode` |
| Read circle | `GET /api/circle/v2/<id>` |
| Report progress | `POST /api/circle/v2/<id>/progress/YYYY-MM-DD` |
| Share an achievement | `POST /api/circle/v2/<id>/showcase` |
| Clap | `POST /api/circle/v2/<id>/claps` |
| Leave / owner remove / owner close | `DELETE /<id>/me`, `POST /<id>/remove`, `POST /<id>/close` |

Successful writes return HTTP 202 and `pending` receipts. Join, leave,
remove and close are eventually consistent. A previously authorized
member may retain access for approximately the provider's propagation
window after removal. This was explicitly accepted for light social;
we make no instantaneous privacy-revocation claim.

## Actual verification achieved before Etest promotion

- Feature branch event-log and eventual-access tests, no-CAS replay,
  retries, invite/owner permissions, IP/account/host gates and API
  transport are included in `circle-core-gate.yml`.
- Current staging integration additionally runs key existing Cloud V4
  backend, multi-session and Blob adapter tests and the frontend build.
- Previous isolated SDK live sandbox verified 15 unique events
  (12 concurrent joins + remove + close), eventual convergence and cleanup:
  https://github.com/smhe00/qwerty-learner/actions/runs/38536214514
- Existing Cloud Sync V4 data structures and Learn/Typing/FSRS UI are not
  modified by the Circle integration.

## Checklist BEFORE touching edgeone-test

1. Confirm `product/main` and `edgeone-test` did not advance since
   the integration base, or regenerate the Circle integration atop the new
   main/etest HEAD and rerun gates; never merge the diverged original
   `feature/circle-core-blob` branch wholesale.
2. Require successful Circle integration CI (98 Circle regression tests,
   36 existing V4/auth/storage regression tests, ESLint and frontend build).
3. Confirm the etest-specific Store binding and environment settings above.
   Do not default to the production `qwerty-data` Store.
4. Explicitly authorize **one** etest deployment; staging auto-deploys on
   advancement of `edgeone-test`. Do NOT update `master`.
5. Wait for the EdgeOne build and verify the live
   `/source-commit.txt` exactly matches the candidate staging SHA.
6. With allowlisted disposable test accounts, smoke: create → join →
   progress → clap → remove → closure; check read isolation, convergence,
   401 revoked session, 403 unlisted user, no counter/CAS and cleanup.
7. Treat a failed embedded-store read/write or any V4 regression as
   **NO GO**, diagnose before additional Maker builds.

**Etest admission is NOT Circle GA**. Account deletion integration,
privacy/retention inventory, UI, invite abuse review, high-volume replay
compaction and real deployed Cloud Functions checks remain future gates.
