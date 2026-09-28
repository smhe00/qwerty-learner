# Qwerty Cloud Sync V1 — Pre-Release Audit

> Date: 2026-09-29  
> Branch: `feature/edgeone-cloud-sync`  
> Audited code commit: `e4e068b8a07c500573be7becb79c96f4929f3f11`  
> Authority for development state remains: `docs/CLOUD_SYNC_DEVELOPMENT_PLAN.md`

## Executive status

The V1 feature implementation is engineering-complete through P7 and all P8 code-side hardening is present.

**Public release is currently blocked by one external platform Gate: EdgeOne precise authentication rate limiting is not enabled on the tested deployment.**

This is now directly verified, not inferred:

- Cloud Sync Gate run `36484045770`: **PASS** at `e4e068b8...`;
- EdgeOne Auth Rate Limit Gate run `36484045749`: **FAIL**;
- rate probe result: 13 consecutive `POST /api/auth/register` requests all reached the application and returned HTTP 400;
- no EdgeOne HTTP 403/429 was observed.

The failed rate-limit run is therefore a deployment-policy failure, not an application regression.

## Release-audit findings

### 1. Scope / upstream intrusion — PASS

Against `feature/spaced-review`, the cloud branch is ahead and not behind.

Existing application intrusion remains minimal:

- all frontend cloud implementation is isolated under `src/sync/`;
- the only pre-existing application file changed for integration is `src/pages/Typing/components/Setting/DataSetting.tsx` (+2 lines);
- Review core, Typing learning flow and IndexedDB schema are not coupled to cloud availability.

### 2. Authentication/session model — PASS for the V1 contract

- opaque 256-bit random session secret;
- raw token not stored server-side;
- server stores SHA-256 token hash;
- one current session per account;
- new login revokes the previous session;
- password change rotates auth version and session;
- session/auth histories are bounded.

Residual V1 risk: the browser remembers the bearer token in `localStorage` for the session TTL, so an origin-level XSS could read it. This is not a new regression introduced by the release audit, but it should be revisited before a higher-trust account model (for example an HttpOnly-cookie design).

### 3. Password storage — PASS

- scrypt;
- random per-password salt;
- bounded password length;
- timing-safe hash comparison.

### 4. Snapshot confidentiality/integrity — PASS

Client-side envelope:

```text
Dexie export
  -> gzip
  -> PBKDF2-SHA-256 (600,000 iterations)
  -> AES-256-GCM
  -> qwerty-sync-envelope-v1
  -> Base64 transport
```

The encryption passphrase is held in browser memory only and is not sent to the server.

AES-GCM authentication is checked before any IndexedDB import.

### 5. Restore failure atomicity — PASS

Before touching IndexedDB, restore validates:

- transport Base64;
- envelope/version;
- PBKDF2/AES-GCM authentication;
- gzip;
- JSON;
- Dexie import metadata.

The actual Dexie import does not set `noTransaction`, so the library's transactional import path remains enabled. The destructive `clearTablesBeforeImport` operation therefore occurs inside the import transaction rather than as an independent pre-clear step.

### 6. Conflict / divergence protection — PASS

- server revision is monotonic;
- stale `baseRevision` is rejected with 409;
- immutable revision creation uses `onlyIfNew`;
- frontend detects local dirty state and local/remote divergence;
- destructive cloud restore requires explicit user confirmation;
- no silent record-level merge is attempted in V1.

### 7. CORS — PASS in code; production configuration must be verified

Runtime default and `.env.example` are `same-origin`.

The release candidate must verify the actual EdgeOne production environment is not still configured with the historical P4 wildcard value.

### 8. Retention / cleanup — PASS

Verified policies:

- snapshots: latest 3;
- external sessions: latest 3;
- external auth versions: latest 2;
- cleanup failures after a durable snapshot commit are treated as maintenance failures rather than turning a successful commit into a misleading client error.

### 9. Sensitive logging — PASS

API logging is limited to method/path/status/error code/error class.

The handler does not log:

- Authorization token;
- username/password;
- encryption passphrase;
- request body;
- snapshot payload.

### 10. Real environment Gates — PASS except rate limiting

Previously verified:

- real EdgeOne API/Blob integration;
- single-active-session behavior;
- revision conflict;
- retention;
- cleanup;
- real Chromium register/login/upload/download/restore;
- encrypted snapshot and wrong-passphrase rejection.

Current static Gate remains green after adding the rate-limit probe.

### 11. Rate limiting — BLOCKER

Required EdgeOne rule:

```text
condition:
  ${http.request.uri.path} in ['/api/auth/register','/api/auth/login']
  and ${http.request.method} in ['POST']

CountBy:
  http.request.ip

Mode:
  Block

threshold:
  10 requests / 60 seconds

duration:
  300 seconds

action:
  Deny / Block
```

After deploying this rule, `EdgeOne Auth Rate Limit Gate` must be rerun and PASS before P8 can close.

## Release decisions after P8

These are release-management items, not additional feature development:

1. freeze production domain;
2. freeze production branch/ref;
3. verify production `CORS_ORIGIN`;
4. record release commit SHA and EdgeOne deployment ID;
5. identify previous known-good deployment as rollback target;
6. rerun all four Gates against the release candidate.

## Current verdict

```text
Feature implementation       READY
Static/CI                    PASS
Real EdgeOne backend         PASS
Real Chromium                PASS
Encryption                   PASS
Retention/CORS/logging       PASS
Precise auth rate limiting   BLOCKED: platform rule not deployed
Public release               HOLD until rate-limit Gate PASS
```
