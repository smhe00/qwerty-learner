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

Makers currently exposes one Precise Rate Limiting rule on the free edition and also applies platform adaptive rate limiting.

Recommended use of the single precise rule for this project:

```text
match:
  method = POST
  path in:
    /api/auth/register
    /api/auth/login

counting dimension:
  visitor / client IP

initial threshold:
  10 requests / 60 seconds

action:
  block for 5 minutes
```

The threshold is a project baseline, not an EdgeOne-required value. Re-evaluate it from real traffic before public scale-up.

Do not implement a simple per-username hard lockout in application code: an attacker could intentionally exhaust another user's attempts and deny that user access.

Official references:

- https://pages.edgeone.ai/document/limits-and-quotas
- https://edgeone.ai/document/55943

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
