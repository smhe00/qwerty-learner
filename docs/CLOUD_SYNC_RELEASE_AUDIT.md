# Qwerty Cloud Sync V1 — Pre-Release Audit

> Date: 2026-09-29  
> Branch: `feature/edgeone-cloud-sync`  
> Review-aware browser test commit: `29bbe06999b0a7f77abde7d632bdcfb2efda18ec`  
> Authority for development state remains: `docs/CLOUD_SYNC_DEVELOPMENT_PLAN.md`

## Executive status

The V1 implementation and all P0-P8 engineering Gates are complete.

The previous dependency on an EdgeOne precise WAF rule was removed after confirming that Makers project/deployment domains cannot attach project-specific security rules. V1 now uses an application-layer per-IP limiter based on the trusted EdgeOne Node Function `context.clientIp`.

Current verified Gates:

- Cloud Sync Gate run `36488214587`: **PASS** at `69dda250...`;
- EdgeOne Live Gate run `36487859692`: **PASS** on the application-rate-limit backend;
- EdgeOne Auth Rate Limit Gate run `36488214624`: **PASS**;
- Review-aware Chromium encrypted-sync Gate run `36500293718`: **PASS** at `29bbe069...`.

P8 is closed. Remaining work is release management: production branch/domain selection, production environment confirmation, release-candidate recording, and rollback target selection.

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

### 10. Real environment Gates — PASS

Previously verified:

- real EdgeOne API/Blob integration;
- single-active-session behavior;
- revision conflict;
- retention;
- cleanup;
- real Chromium register/login/upload/download/restore;
- encrypted snapshot and wrong-passphrase rejection.

Current static Gate remains green after the application limiter and live rate-limit probe.

### 11. Review × Cloud consistency — PASS

The real Chromium cloud-sync test now includes the current spaced-Review data model rather than validating only generic `wordRecords`.

Run `36500293718` passed on the real EdgeOne deployment and verified:

- `WordRecord.typingTelemetry` survives encrypted upload/restore;
- `WordRecord.learningContext` survives encrypted upload/restore;
- `reviewWordStates` scheduler state, counters, due time and outcome survive exactly;
- `reviewRecords` queue order, duplicate reinforcement entry, current index and unfinished-session state survive exactly;
- changing only Review state marks the whole database dirty;
- a wrong encryption passphrase leaves local Review state unchanged;
- deliberately corrupted local Review scheduler/session state is replaced by the exact cloud snapshot after an explicit restore.

This validates the V1 architectural choice to synchronize one encrypted RecordDB snapshot/revision rather than introducing a separate Review cloud API.

### 12. Rate limiting — PASS

The deployed V1 limiter is application-layer because the current Makers project/deployment domain cannot attach a custom precise-rate-limit rule.

```text
trusted identity: context.clientIp
scope:            POST /api/auth/register + /api/auth/login
counter:          shared per IP
threshold:        10 / 60 seconds
over-limit:       HTTP 429 auth_rate_limited
retry guidance:   Retry-After
storage:          strong-consistency Blob + onlyIfNew immutable slots
raw IP stored:    no
```

The dedicated real EdgeOne Gate run `36488214624` passed. It verified the first ten auth requests reach application validation, the eleventh is blocked with application HTTP 429, login shares the same counter, and health traffic is unaffected.

One earlier live run (`36487403203`) observed a transient HTTP 500 during repeated login. The immediate rerun (`36487859692`) passed without changing the backend implementation. This is retained as an operational observation; monitor aggregate `internal_error` / authentication availability after rollout, but it is not a reproducible release blocker.

## Branch convergence

The integrated product no longer maintains Review and Cloud as separate active long-lived feature lines.

- `feature/spaced-review` is frozen at `93b40e0784ea26cf300d10d8e67365f16618e7e3`;
- `archive/review-baseline-20260928` preserves the same historical baseline;
- `feature/edgeone-cloud-sync` is the temporary integrated RC line;
- after the final four-Gate RC passes, `product/main` becomes the only active integrated product branch;
- future upstream contribution branches remain separate and are cut from an upstream-compatible baseline.

See `docs/BRANCH_STRATEGY.md`.

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
Application auth rate limit  PASS
P0-P8 engineering Gates      COMPLETE
Public release               READY FOR RELEASE-MANAGEMENT GATE
```
