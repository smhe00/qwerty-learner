# Qwerty EdgeOne Cloud Sync — Development Plan & Handoff

> **Authority:** This document is the durable continuation point for the cloud-sync work.  
> **Branch:** `feature/edgeone-cloud-sync`  
> **Rule:** Future sessions/agents should read this file first, then read the current branch HEAD and diff. Do not rely on old chat context as the source of truth.

## 1. Objective

Add optional user accounts, persistent cloud storage, and cross-device sync to Qwerty Learner while keeping the upstream application minimally affected.

The application remains **local-first**:

- Without login: existing upstream behavior remains unchanged; IndexedDB is the only data store.
- With login: IndexedDB is still the working database; EdgeOne Blob is used for account state and opaque sync snapshots.
- Learning, Typing, dictionaries, Review scheduler, and telemetry must not depend on cloud availability.
- Network failure must not block learning.

## 2. Non-goals for V1

V1 deliberately does **not** include:

- mandatory login;
- profile/avatar/social features;
- password reset by email/SMS;
- concurrent multi-device editing;
- automatic record-level merge of divergent offline histories;
- server-side interpretation of WordRecord / ReviewWordState / telemetry;
- Gitee as the production database;
- Huawei FunctionGraph as the production runtime.

The earlier Huawei/Gitee prototype was useful validation only.

## 3. Upstream-intrusion policy

Until the backend and storage contract pass independently:

- **Do not modify `src/`.**
- Do not modify `src/review/`.
- Do not modify Typing flow.
- Do not modify existing IndexedDB schemas.
- Do not modify dictionary resources.
- Do not add login requirements to application startup.

Later frontend integration should be isolated under `src/sync/` plus the smallest possible Settings/Data UI entry.

Cloud-specific code stays under:

```text
cloud-functions/
tests/cloud/
docs/CLOUD_SYNC_*.md
edgeone.json
.env.example
```

Only root dependency/build metadata may be changed when required for EdgeOne.

## 4. Target platform

Production target:

```text
GitHub repository
       │
       ▼
EdgeOne Makers
├── existing Qwerty static/Vite frontend
├── Cloud Functions: /api/*
└── Blob: qwerty-data
```

GitHub stores source, tests, docs and deployment configuration.

EdgeOne Blob stores runtime user state.

Browser IndexedDB stores working learning data.

No application secret should be required for normal runtime.

## 5. Authentication model — single active session

### 5.1 Decision

Each account may have **exactly one current cloud session**.

A new successful login revokes the previously current session.

This intentionally simplifies V1 cross-device behavior.

### 5.2 Session token

Do not use JWT and do not use `APP_SESSION_SECRET`.

Generate a 256-bit random secret per login:

```text
crypto.randomBytes(32)
```

Public token format:

```text
qs1.<usernameHash>.<randomSecretBase64Url>
```

where:

- `usernameHash = SHA256(normalizedUsername)`;
- the random secret provides unforgeability;
- the server stores only `SHA256(fullToken)`, never the raw token.

Authentication flow:

```text
Bearer token
   ↓
parse usernameHash
   ↓
load account
   ↓
load latest session version using strong consistency
   ↓
compare SHA256(token) with stored tokenHash
   ↓
check expiry + userId + authVersion
```

### 5.3 Session versioning

Sessions are immutable version objects.

New login:

```text
latest session version = N
create N+1 using Blob onlyIfNew
```

If another login races and wins N+1, re-read latest and retry with the next version.

The highest session version is the only valid session.

Registration embeds session version 1 in `identity.json` so account creation and first session do not require a second atomic write.

### 5.4 Password change

Password history remains immutable auth versions.

Password change:

1. authenticate current session;
2. verify current password;
3. create auth version N+1 with `onlyIfNew`;
4. issue a new session version bound to auth version N+1.

Because authentication checks both latest session and latest auth version, old sessions are invalid immediately after password change.

## 6. No runtime secrets

Remove:

```text
APP_SESSION_SECRET
TEST_SECRET
ENABLE_SELF_TEST
```

Also remove the public:

```text
POST /api/__test/full
```

Full contract testing stays in GitHub/local test code and does not create a production HTTP backdoor.

Expected runtime configuration:

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
CORS_ORIGIN=*
```

After frontend and backend share one production domain, prefer a specific origin or same-origin requests instead of `*`.

## 7. Password storage

Passwords are never stored in plaintext.

Current policy:

```text
scrypt
salt: random 16 bytes
key length: 64 bytes
N=16384
r=8
p=1
```

Account filenames use SHA256(normalized username), not the literal username.

## 8. EdgeOne Blob data model

Namespace:

```text
qwerty-data
```

Layout:

```text
accounts/
  <usernameHash>/
    identity.json
    auth/
      000000000002.json
      000000000003.json
      ...
    sessions/
      000000000002.json
      000000000003.json
      ...

users/
  <userId>/
    revisions/
      000000000001.json
      000000000002.json
      ...
```

`identity.json` contains:

- immutable account identity;
- initial auth version 1;
- initial session version 1;
- status and timestamps.

All account/session/revision state-machine reads use Blob **strong consistency**.

All version creation uses `onlyIfNew`.

## 9. Sync model

### 9.1 Keep immutable revision protection

Even with a single active account session, retain monotonic revisions because they protect against:

- multiple browser tabs sharing one session;
- duplicated HTTP retries;
- request reordering;
- stale client state;
- accidental replay.

Upload contract:

```json
{
  "baseRevision": 10,
  "payloadBase64": "...",
  "deviceId": "...",
  "clientFormatVersion": "..."
}
```

Server:

```text
read latest revision with strong consistency
require baseRevision == latest
create latest+1 with onlyIfNew
```

If creation loses a race, return `409 sync_conflict`.

### 9.2 No automatic multi-device merge in V1

Single-active-session removes normal simultaneous editing, but offline divergence is still possible.

Example:

```text
PC A learns offline after revision 20
PC B later logs in and advances cloud to revision 25
PC A logs in again with unsynced local changes
```

V1 must not silently overwrite either side.

Frontend policy when:

```text
localDirty = true
localBaseRevision != remoteRevision
```

is to stop automatic sync and offer an explicit recovery choice, initially:

- keep local data / export backup;
- use cloud data.

Record-level merge can be a later phase.

## 10. API V1

Public API:

```text
GET  /api/health

POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/change-password

GET  /api/sync/meta
GET  /api/sync
PUT  /api/sync
```

No public test endpoint.

## 11. Storage contract

The platform-independent backend core should depend only on these storage operations:

```text
createAccount(usernameHash, identity)
getAccount(usernameHash)

createAuthVersion(usernameHash, version, record)
getLatestAuth(usernameHash)

createSessionVersion(usernameHash, version, record)
getLatestSession(usernameHash)

createRevision(userId, revision, snapshot)
getLatestRevision(userId)
pruneRevisions(userId, keepCount)

deleteUserData(usernameHash, userId)   # tests/admin only
```

The EdgeOne adapter implements these operations using Blob.

## 12. Backend test gate

The backend contract test must verify at least:

1. registration succeeds;
2. duplicate username rejected;
3. wrong password rejected;
4. registration session works;
5. login creates a new session;
6. registration session is revoked by login;
7. a second login revokes the first login;
8. `auth/me` works only for latest session;
9. new account remote revision is 0;
10. first upload produces revision 1;
11. download matches byte-for-byte Base64 payload;
12. stale `baseRevision` gets `409 sync_conflict`;
13. next upload produces revision 2;
14. password change succeeds;
15. previous session is revoked;
16. old password rejected;
17. new password login succeeds;
18. password change does not alter sync data;
19. malformed/random token rejected;
20. cleanup removes account/auth/session/revisions;
21. after advancing beyond three snapshots, only the latest three revision objects remain while the revision number continues increasing.

Backend does not advance to frontend integration until this test passes locally and against real EdgeOne Blob.

## 13. Development phases

### P0 — durable plan and branch discipline
- [x] dedicated branch `feature/edgeone-cloud-sync`
- [x] cloud code isolated from `src/`
- [x] this authoritative development plan committed

### P1 — single-session backend
- [x] remove JWT/HMAC session logic
- [x] remove `APP_SESSION_SECRET`
- [x] implement opaque random session token
- [x] implement immutable session versions
- [x] enforce one current session per account
- [x] password change rotates both auth and session
- [x] update in-memory storage test double
- [x] update full backend contract test

### P2 — remove public self-test / runtime secrets
- [x] delete `/api/__test/full`
- [x] remove `TEST_SECRET`
- [x] remove `ENABLE_SELF_TEST`
- [x] keep self-test as local/GitHub test code only
- [x] update docs/env example

### P3 — local/CI static verification
Required before deployment:
- [x] `yarn test:cloud` — GitHub Cloud Sync Gate PASS
- [x] cloud-only ESLint: `yarn eslint cloud-functions tests/cloud --ext .js,.mjs` — GitHub Cloud Sync Gate PASS
- [x] `yarn build` — GitHub Cloud Sync Gate PASS
- [x] inspect branch diff: no accidental `src/` changes

Full-repository `yarn lint` is not a cloud-sync Gate because the current base branch already contains an unrelated existing error in `src/pages/Typing/components/WordPanel/components/Word/index.tsx` (`no-case-declarations`). Cloud work must not modify that upstream/Typing code merely to make this feature Gate green.

### P4 — EdgeOne real integration gate

P3 gate result: GitHub Actions **Cloud Sync Gate PASS** at commit `2a8f7f3f9230ca83d6b8f9a8356cd561c9270a3f` (contract tests + isolated cloud lint + full Qwerty build).

Deployment/runbook: `docs/CLOUD_SYNC_EDGEONE_DEPLOYMENT.md`.

Observed EdgeOne deployments on 2026-09-28:
- `master` deployment `dpk9qxv0ione` — SUCCESS at commit `1182426f2bd0a28c95302c33f9e19136b1262a70`;
- `feature/edgeone-cloud-sync` deployment `dppemfs6uhvm` — SUCCESS at commit `6e28b3de03cdbb70e917de5b3c9e4609912138f4`.

This confirms both the pure-static upstream build and the cloud-sync branch can be accepted by EdgeOne. P4 now moves from build/deploy validation to runtime API/Blob validation.

- [x] connect GitHub branch/project — project created in EdgeOne Makers
- [x] deploy cloud-sync branch successfully
- [ ] confirm Cloud Function route `/api/health` from the deployed feature environment
- [ ] create/use Blob namespace `qwerty-data`
- [ ] exercise API via HTTPS — `yarn test:cloud:edgeone`
- [ ] verify single-session revocation against real Blob
- [ ] verify revision conflict against real Blob
- [ ] verify cleanup/test data handling — live integration script cleans directly through admin Blob credentials
- [ ] close any platform-specific compatibility defects

### P5 — frontend sync client
Only after P4 passes.

Add isolated:

```text
src/sync/
  api.ts
  auth.ts
  snapshot.ts
  state.ts
  types.ts
```

Do not modify Review core.

Initial frontend capabilities:

- login/register/logout;
- remember current token locally;
- manual upload/download;
- revision metadata;
- local dirty/baseRevision tracking;
- explicit divergent-state handling.

### P6 — snapshot packaging
- [ ] IndexedDB export
- [ ] gzip
- [ ] client-side AES-GCM
- [ ] Base64 transport
- [ ] restore validation
- [ ] format versioning

Encryption key UX must be designed before claiming end-to-end encrypted backups.

### P7 — minimal UI
Add only a small cloud-sync area under existing Data Settings:

- logged-out: username/password/register/login;
- logged-in: account, sync status, last sync, remote revision, sync/logout.

No separate profile system.

### P8 — operational hardening
Before broader public use:
- [ ] specific CORS/same-origin policy
- [ ] abuse/rate-limit strategy for login/register
- [x] snapshot retention policy: keep latest 3 full revisions
- [ ] retention policy for old session/auth versions
- [ ] backup/export strategy
- [ ] monitoring/error telemetry without sensitive payloads

## 14. Continuation protocol for future sessions

When resuming work:

1. Read this file.
2. Fetch branch `feature/edgeone-cloud-sync`.
3. Record current HEAD.
4. Compare it to `feature/spaced-review`.
5. Read:
   - `docs/CLOUD_SYNC_ARCHITECTURE.md`
   - `cloud-functions/_shared/core.js`
   - `cloud-functions/_shared/storage/edgeone-blob.js`
   - `cloud-functions/api/[[default]].js`
   - `tests/cloud/backend-core.test.mjs`
6. Continue from the first unchecked development gate.
7. Never infer project state solely from prior chat.
8. Do not touch existing `src/` until P4 is passed unless the user explicitly changes this rule.
9. For every repository write, report the exact commit SHA and remaining blockers.
10. Never commit passwords, raw session tokens, API tokens, or real user data.

## 15. Current architectural invariant

The most important invariant is:

> **Cloud sync is an optional platform layer around Qwerty, not a dependency of Qwerty learning logic.**

If EdgeOne is unavailable, a user must still be able to open Qwerty and learn locally.
