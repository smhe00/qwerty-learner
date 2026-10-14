# Circle etest live read-only checkpoint — 2026-10-15 (Asia/Shanghai)

**Result:** Deployment SHA PREFIX verified, Circle code present but public Circle
API currently 404 (unenabled or not mounted), no user data touched. Do not
claim Circle real API/Blob E2E PASS yet.

## Actual evidence

- Read-only GitHub Actions run:
  https://github.com/smhe00/qwerty-learner/actions/runs/38636761755 — PASS.
- `edgeone-test` ref SHA:
  `30e0be26c05eef1eb3c85c644e85f8e22c30270c`
- `https://etest.edgeone.dev/source-commit.txt`: HTTP 200, text
  `30e0be2`. It is a valid 7-character abbreviated SHA matching the
  staging ref. Existing `scripts/verify-edgeone-source.mjs` explicitly
  accepts 7–40 hex prefix; do NOT interpret the short marker as a full SHA.
- `/api/health`: HTTP 200, `qwerty-sync-gateway`; exposes
  `v4-http-binary-192k-v1`, `v4-end-to-end-binary-v1`,
  `v4-binary-direct-512k-v1`, `v4-http-multipart-v1`.
- `GET /api/circle/v2` with **NO bearer token**: HTTP 404,
  `{"ok":false,"error":"not_found"}`. This is consistent with
  `CIRCLE_ETEST_ENABLED` being absent/not equal `true` or the route
  being unavailable; it is not evidence that Circle is live.
- No credentials, test accounts, protected records, private Circle
  objects or Maker builds were created/changed during the probe.

## Base64 audit (deployed edgeone-test branch)

The active Circle modules `assembly.js`, `event-log.js`,
`etest-gateway.js`, `http.js`, `privacy.js`, `reducer.js`,
`revocation.js`, `service.js`, `transport.js` and the optional
`trusted-access-adapter.js` do not use `base64`, `base64url`,
`atob` or `btoa`. `event-log.js` persists JSON objects with
`blob.setJSON`; `transport.js` uses `Buffer.from(Uint8Array)`
for bounded JSON request streaming, **not** Base64 encoding. Circle
does not import V4 sync binary multipart/backup codecs. An auth token
may use its own representation inside the separate V4 session system.

The main V4 gateway retains a compatibility path for legacy Base64
requests (unrelated to Circle), while live health advertises the new
binary data transport. No guarantee is made here that all old V4
compatibility paths have been removed.

## Independent failing check

Latest staging `Branch EdgeOne Cloud E2E` run
https://github.com/smhe00/qwerty-learner/actions/runs/38634270287
succeeded in browser cloud E2E but failed the large V4 multipart upload
in `real-v4-transport`. This is **not a Circle test** and cannot prove
a Circle failure, but staging overall is not fully green.

## Next gate — no Maker build from this task

For Circle HTTP API E2E, the etest Maker project needs an explicit
Circle-only environment activation:

- `CIRCLE_ETEST_ENABLED=true`
- `CIRCLE_ETEST_BLOB_STORE=qwerty-circle-sandbox`
- `CIRCLE_ETEST_INVITE_KEY`: private random 32+ character secret,
  configured via secure environment settings (never GitHub/chat)
- `CIRCLE_ETEST_USER_IDS`: comma-separated immutable IDs of 1–16
  disposable **existing** etest accounts; NOT usernames.

The named sandbox Store must be accessible to embedded etest Cloud
Functions and remain isolated from all V4 user records. The pilot's
account-deletion safety guard blocks allowed test accounts until
audited Circle cleanup, so DO NOT create/delete disposable accounts
without a fully authorized cleanup plan.

Once the gate returns authenticated 401 on an unauthorized request
and dedicated credentials/lifecycle are available, run:
create -> invite join -> progress -> clap -> owner remove ->
remove-wins eventual convergence -> close -> close-wins ->
replay/read isolation -> verified cleanup.

Do not deploy a new Maker build or move `product/main`,
`edgeone-test` or `master` from this read-only audit.
