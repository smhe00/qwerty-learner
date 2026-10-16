# Circle API direct launch — 2026-10-17

## Scope
Authenticated **API-only** launch on the existing EdgeOne Cloud Function.
No Circle frontend is included. The existing learning UI, FSRS and Cloud
Sync V4 endpoints are unchanged.

Removed deployment prerequisites:
- No `CIRCLE_ETEST_ENABLED` / Circle feature toggle.
- No `CIRCLE_ETEST_USER_IDS` account allowlist.
- No `CIRCLE_ETEST_INVITE_KEY` server secret.
- No second Blob Store or project-specific Circle credentials.

Runtime rules:
- Existing V4 Bearer account session is required.
- The existing EdgeOne private `BLOB_STORE_NAME` (default `qwerty-data`)
  is reused, but Circle writes only `social/v2/circles/**` events and
  `social/v2/accounts/**` participation markers. These keys are isolated
  from existing V4 backup, identity and session namespaces.
- A trusted EdgeOne source IP is required for rate limiting, without
  client-provided forwarding headers.
- The create `operationId` **must be a new cryptographically random
  UUIDv4** (such as `crypto.randomUUID()`). It is used as the secret
  HMAC key for an idempotent invitation, so DO NOT use predictable UUIDs
  or share the raw operation ID. Retries reuse the exact same operation ID.
- Circle responses report eventual consistency, not an immediate or
  atomic global state.
- Accounts that have written Circle events receive a conservative
  deletion hold (`409 circle_deletion_requires_cleanup`) until
  account-level event cleanup is implemented and audited. The guard
  does not claim guaranteed erasure under eventually consistent Blob.
  Do not disable this protection without a deletion lifecycle.
- Request budget 8192 bytes, response budget 65536 bytes and event
  replay budget 2000 records per Circle; rate limit 60 requests/minute
  per IP and account (best effort under non-atomic Blob).
- No changes to `master` should be made before the isolated Circle
  and existing V4 regression suites pass.

## API examples
All URLs are relative to `https://q.smhe.cn/api/circle/v2`.
The account token comes from ordinary V4 login (never paste tokens in
issues, docs, CI logs or this chat).

1. `POST /`, with
   `{"name":"Study group","operationId":"<fresh UUIDv4>"}`
   returns HTTP 202 with `result.circleId` and a private `result.inviteCode`.
2. `POST /join`, with `{"inviteCode":"<code>"}`.
3. `GET /<circleId>` reads eventual Circle membership.
4. `POST /<circleId>/progress/2026-10-17`,
   with `{"completed":true,"newWords":12,"eventId":"progress_0001"}`.
5. `POST /<circleId>/claps`, with
   `{"memberUserId":"<member ID>","day":"2026-10-17"}`.
6. `POST /<circleId>/remove`, with
   `{"memberUserId":"<member ID>"}`; only owners may remove.
7. `POST /<circleId>/close`, with `{}`.

Poll authenticated reads after writes until the view converges; never
interpret HTTP 202 as globally final. The existing web app does not
yet expose Circle through a UI.

## Operational caveat

Reusing the V4 Blob Store does not give physical separation. A scoped
social/ key prefix prevents direct key overlap, but an infrastructure
store-wide outage, quota or retention change can affect both.
Do not describe this as an independently isolated Blob Store.

The API is experimental until the physical-erasure lifecycle and
full real EdgeOne end-to-end multi-account test are complete.
