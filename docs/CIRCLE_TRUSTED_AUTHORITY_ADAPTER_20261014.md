# Circle v2 — V4 session and independent trusted access adapter

**Date:** 2026-10-14  
**Status:** IMPLEMENTED / OFFLINE-TESTED / HTTP GATE CLOSED / NOT READY FOR RELEASE.  
**Branch:** `feature/circle-core-blob`. No changes to V4, UI, Maker or protected branches.

## Purpose

`cloud-functions/_shared/circle/trusted-access-adapter.js` supplies
`createCircleTrustedAccessAdapter({backend,authority,nowSeconds})` to assemble
two complementary security roles:

1. **Session identity** is re-checked through the *existing*
   `createBackendService(...).me(token)` method at every Circle service
   authentication / access boundary. It validates the user ID, positive session
   version and expiry and maps provider outages to a typed `503` instead of
   exposing raw storage errors. Known V4 `401` revoked/expired responses
   remain `401`.
2. **Independent Circle authority** must be an already reliable, separately
   deployed trusted component. The adapter refuses construction if it lacks any
   of `check`, `commitRevocation`, `lookupRevocation`,
   `authorizeMaintenance`, or `lookupRetirement`.
   There is **no fallback to Blob/KV mutexes, in-process maps or optimistic
   read-then-write fencing**.

**Important:** the existing Cloud Sync V4 session implementation uses Blob and
is **not** a strong consistency/instant revocation oracle. Rechecking
`backend.me` improves session hygiene but is not a replacement for
`authority.check` or a guarantee that login/session expiry propagates
instantaneously across EdgeOne regions.

## Adapter contract

| Adapter method | Requirement / failure behavior |
| --- | --- |
| `authenticate(token)` | Call V4 `me(token)` afresh; validate `user.userId`, `session.version`, `session.expiresAt`. Wrong/expired/unknown session fails; never authorize from cached claims. |
| `trustedAccess.check(context)` | Re-authenticate; require exact actor identity; delegate circle/action/phase/`viewHash`/all visible subject IDs and session version to *independent* authority; only literal `true` allows. Any error, `undefined`, false or stale session denies. |
| `trustedAccess.revoke(context)` | Re-authenticate and validate actor/command/scope. `authority.commitRevocation` must durably fence and return `{status:'committed', operationId, commandHash}` matching the exact command. Boolean accepted is rejected. |
| `trustedAccess.lookupRevocation` | Reliable receipt lookup; `null` means definitively not committed, outages/invalid receipt throw fail-closed errors. Never infer receipt from the eventually consistent event log. |
| `trustedAccess.authorizeMaintenance` | Explicit server-only maintenance capability; literal `true` required for any recovery or physical scrub. Caller/authorization must not be a user-controlled API parameter. |
| `trustedAccess.lookupRetirement` | Validate retired account ID and durable fence ID; outages and malformed response fail closed. `null` only when reliable provider confirms not retired. |

Bearer tokens are supplied exclusively to the V4 backend method, **not passed to
the independent authority** by the adapter. The independent authority receives
account/session proof metadata, scope and subjects; it must verify both the
current session generation and all lifecycle/visibility fences atomically in
its own trustworthy data plane.

This is an **interface contract**, not implementation of the external authority.
In particular a mock method returning `true` does not establish any
distributed consistency property.

## Non-production integration example

```js
import { createCircleTrustedAccessAdapter } from './trusted-access-adapter.js'
import { createCircleService } from './service.js'
import { createCircleEventLog } from './event-log.js'

// backend = createBackendService({ storage: EXISTING_V4_STORAGE })
// authority = independently provisioned, STRONGLY CONSISTENT Circle provider
// blobStore = a scoped server-private Circle Blob Store
const bridge = createCircleTrustedAccessAdapter({ backend, authority })
const service = createCircleService({
  log: createCircleEventLog(blobStore),
  authenticate: bridge.authenticate,
  trustedAccess: bridge.trustedAccess,
  inviteKey: SERVER_SECRET,
})
```

The example intentionally does **not** mount the service in the existing
Cloud Functions gateway. There is no configured or verified `authority`
provider for production. `cloud-functions/_shared/circle/http.js` remains
unconditionally closed. No client can enable the route through an env flag.

## Tests

GitHub Actions **Circle Core Gate** now runs both:
- `tests/cloud/circle-core.test.mjs`
- `tests/cloud/circle-trusted-access.test.mjs`

The additional tests cover missing dependencies, direct V4-`me` response
shape, invalid/expired/revoked sessions, fresh checks, actor mismatch, subject
binding, no raw token propagation to independent authority, provider outage
denial, exact durable revocation receipts, definitive-null versus failed lookup,
retirement fences, forbidden maintenance, and real Circle service integration
with non-CAS in-memory Blob. An in-flight read simulates revocation between
scan and private return. A bare boolean acceptance is rejected as a durable
fence.

Results of the exact feature HEAD CI must be checked before claiming a
passing gate. Mock independence is testable; remote authority consistency is not
yet certified.

## Release blockers

1. Choose and provision a *real* strongly consistent authority or otherwise
   redesign privacy revocation to avoid requiring instant server-side
   authorization. EdgeOne Blob and KV are explicitly excluded as authoritative
   CAS/lock stores; simply exposing these adapter callbacks with in-memory
   state is **not** sufficient.
2. Design independent authority lifecycle for user/circle scopes, session
   versions, retirement, revocation receipts, atomic idempotent commit and
   per-user visibility. Certify failure, regional and retry semantics.
3. Wire a trustworthy source-IP/account limiter. Existing Blob auth rate-limit
   mechanisms are **not** sufficient evidence for robust global Circle abuse
   protection.
4. Integrate account deletion/orchestration and replay privacy audit under
   durable retirement fences, with legal/minor privacy requirements.
5. Explicitly authorize a *separate* EdgeOne test deployment and verify
   Cloud Functions route/stores end-to-end before any UI or `master` release.

**Current decision:** keep offline v2 backend; no production HTTP route, no
frontend change, no Maker build, and no Circle access granted without a
configured trustworthy authority.
