# Qwerty Cloud Sync Operations & Security

## Scope

This document covers production hardening that sits outside learning logic:

- CORS;
- authentication abuse/rate limiting;
- bounded Blob history;
- safe operational logging;
- backup/recovery.

No rule in this document changes the local-first invariant.

## CORS

Default runtime policy:

```text
CORS_ORIGIN=same-origin
```

Same-origin browser calls need no cross-origin permission. If a future frontend is hosted on a different trusted origin, configure an explicit comma-separated allowlist.

Do not use `CORS_ORIGIN=*` in normal production operation.

CORS is a browser boundary, not an authentication or abuse-prevention mechanism.

## Authentication rate limiting

### Platform constraint

EdgeOne Makers exposes platform adaptive rate limiting on project/deployment domains, but those domains cannot attach project-specific custom security rules. Precise rate-limiting rules require an editable custom-domain security policy.

V1 therefore treats EdgeOne's adaptive protection as a coarse outer layer and implements the authentication limiter inside the Cloud Function. This keeps the release independent of custom-domain eligibility.

### Application limiter

Protected endpoints:

```text
POST /api/auth/register
POST /api/auth/login
```

Policy:

```text
identity:          EdgeOne EventContext clientIp
shared dimension:  one counter across register + login
threshold:         10 requests
window:            60 seconds, fixed window
over limit:        HTTP 429 auth_rate_limited
response header:   Retry-After
```

The limiter runs **before** JSON body processing and before password `scrypt`, so repeated credential guesses do not consume password-hashing work once the IP has exhausted its window.

Do not implement a per-username lockout: an attacker could intentionally exhaust another user's account and deny that user access.

### Privacy / storage design

The raw IP address is not written to Blob.

```text
clientIp
  -> SHA-256("qwerty-auth-rate-v1" || NUL || clientIp)
  -> rate-limit/auth/<clientKey>/windows/<windowStart>/slot-NNN.json
```

Each request claims one immutable slot with Blob `onlyIfNew`. Slot discovery uses strong consistency. Request `limit + 1` becomes the sentinel that marks the current window as blocked.

Only the current/recent windows are needed; stale windows are best-effort pruned. The limiter namespace is separate from account/session/snapshot data.

If EdgeOne does not supply `context.clientIp`, authentication fails closed with HTTP 503 `client_ip_unavailable` rather than silently bypassing the limiter.

Runtime defaults:

```text
AUTH_RATE_LIMIT_REQUESTS=10
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
```

### Validation Gate

Repository validation:

```text
workflow: EdgeOne Auth Rate Limit Gate
script:   tests/cloud/edgeone-rate-limit.integration.mjs
```

The live probe deliberately uses an invalid short username, so it creates no account. It aligns to a fresh fixed window and verifies:

1. requests 1-10 reach application validation and return `invalid_username`;
2. request 11 returns HTTP 429 `auth_rate_limited`;
3. `Retry-After` is present and within the current window;
4. `/api/auth/login` is blocked by the same shared IP counter;
5. `/api/health` stays HTTP 200.

Verified on 2026-09-29:

```text
implementation: 7a0b99b4e8a3fd9a21732907934ce233368f3faf
live backend:   EdgeOne Live Gate 36487859692 PASS
rate-limit E2E: EdgeOne Auth Rate Limit Gate 36488214624 PASS
gate commit:    69dda250f0178ed883d06e0d5c4242014ee9346c
```

The earlier WAF-oriented negative run `36484045749` remains useful history: it proved that the Makers project domain itself was not applying a configurable precise rule, which led to the application-layer design.

Official references:

- https://pages.edgeone.ai/document/node-functions
- https://pages.edgeone.ai/document/blob-storage
- https://pages.edgeone.ai/document/limits-and-quotas

## Blob retention

Bounded immutable history:

```text
snapshots: latest 3 full revisions
sessions:  latest 3 external versions
auth:      latest 2 external versions
```

Initial auth/session version 1 remains embedded in `identity.json`.

Retention cleanup happens only after the new immutable version is durably committed. Cleanup failure is maintenance failure and must not change an already-successful login/password/sync operation into a client-visible failure.

## Safe operational logs

Cloud API errors are emitted as structured JSON containing only:

```text
event
method
path
status
code
errorName
```

Retention failures contain only:

```text
event
area
errorName
errorCode
```

Never log:

- Authorization/session token;
- username or password;
- cloud encryption passphrase;
- request body;
- snapshot payload/ciphertext;
- full Blob object path;
- userId/usernameHash unless a future incident workflow explicitly requires a pseudonymous correlation ID.

Operational monitoring should aggregate counts by HTTP status/error code, especially:

```text
invalid_credentials
session_revoked
sync_conflict
session_update_conflict
account_update_conflict
internal_error
```

## Backup and recovery

The existing local manual export remains the independent recovery path.

Before choosing a destructive cloud restore when local data is dirty, the UI tells the user to export local data first.

Cloud encryption passphrases cannot be recovered by the server. Losing the passphrase does not destroy local IndexedDB data or local export capability.
