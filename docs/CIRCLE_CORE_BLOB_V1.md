# QWERTY Circle Core — Blob-only Kernel (S0 / first implementation)

> Branch: `feature/circle-core-blob`
> Baseline: `product/main` at `c2e8cbbb4d7a6509b956c36e4245bfab122abfea`
> Deployment status: **NOT EXPOSED / NOT RELEASE READY**
> Contract owner: Circle backend; separate from Learn, Typing, FSRS, cloud V4, UI.

## Purpose and boundaries

QWERTY Circle is a **shared social data domain** implemented on the existing EdgeOne Blob store. Personal account/workspace data stays in `accounts/` and `users/` and is never copied into Circle records. Circle keys use `social/v1/` exclusively.

New files:

- `cloud-functions/_shared/circle/blob-storage.js`: strong-read, atomic create-only Blob adapter.
- `cloud-functions/_shared/circle/service.js`: transport-free authenticated domain service.
- `tests/cloud/circle-core.test.mjs`: correctness, 30-way parallel membership, authorization and idempotency tests.
- `.github/workflows/circle-core-gate.yml`: **feature-only** test/lint, no Maker builds.

No frontend, pages, routes, Learn engine, backup schema, or existing account API was changed.

## Implemented kernel operations

| Operation | Meaning | Invariant |
| --- | --- | --- |
| `createCircle(token, {name})` | Create owner-owned Circle and secret invite | One atomic immutable meta record |
| `joinCircle(token, code)` | Join by high-entropy compound invite | 11 fixed CAS seats; <=12 users total |
| `getCircle(token, id)` | Read membership summary | Only active members |
| `leaveCircle(token,id)` | Member self-revocation | Immutable, permanent in first iteration |
| `removeMember(token,id,uid)` | Owner removes a member | Owner-only, cannot revoke owner |
| `closeCircle(token,id)` | Owner closes Circle | Immutable closure tombstone |
| `publishProgress(token,id,day,event)` | Publish authorized daily aggregate | Self-reported; <=4 updates / user / UTC day |
| `getProgress(token,id,day)` | Read visible active-member reports | Member-only; filters revoked authors |
| `reactProgress(token,id,uid,day)` | Clap to a visible progress item | One immutable clap per actor and target/day |
| `getReactions(token,id,uid,day)` | Read aggregate clap count | Only active members counted |
| `shareAchievement(token,id,achId)` | Publish verified achievement | Requires injected server-side verifier |
| `getShowcase(token,id,uid,ids)` | Read visible verified shares | Member-only |

The injectable `authenticate(token)` callback MUST be implemented on the server with the existing `createBackendService.me(token)` equivalent. This kernel never accepts a client-supplied `userId` as actor identity. `verifyAchievement(userId,achievementId)` MUST check trusted learning evidence before badge publication; without that callback, publish is denied.

## Physical layout

```text
social/v1/circles/<circleId>/
  meta.json                            # immutable; includes SHA-256(invite secret)
  closed.json                          # immutable closure tombstone
  seats/01.json ... seats/11.json      # immutable claimed by single userId
  revoked/<userId>.json                # immutable membership revocation
  progress/<userId>/<YYYY-MM-DD>/00.json ... 03.json
  reactions/<actorUserId>/<authorUserId>/<YYYY-MM-DD>.json
  showcase/<userId>/<achievementId>.json
```

The invite code format is `QC-<12-char Circle ID>-<12-char random secret>`. The invite uses a random secret and cannot be inferred from listing Circle metadata. This is a first implementation copy/paste code, not a final UX-ready six-character passcode. Never log secrets.

## Concurrency contract

1. Blob `setJSON(...,{onlyIfNew:true})` is the sole reservation primitive; **must pass a live Blob atomic-create contract test** before endpoints are exposed.
2. Fixed 11 immutable peer seats avoid unsafe "read count, then append" capacity checks.
3. On lost write responses, a strong read verifies whether the candidate committed or a different writer won; a conflicting record is never overwritten.
4. Progress per-day is bounded to four create-only slots; duplicates with the same event ID and same content return the existing record.
5. Reactions are one immutable per-author/per-target/day record, so concurrent actors do not update a shared counter.
6. Read paths filter all revoked members and deny reads to revoked callers. Visibility is authorization-controlled, not a direct Blob public link.
7. No destructive update to the V4 account or workspace API.

## Known design limitations / production blockers

**G0 — Account lifecycle:** existing `deleteAccount` does not cascade into Circle membership, progress, and reaction records. Do not wire production HTTP routes until account deletion, privacy purge, retryable cleanup and crash recovery are designed and tested. Logout/expiry must also remain identity safe.

**G1 — Membership lifecycle:** fixed seats are **lifetime allocations**. Leaving or removal does not free capacity, and a revoked member cannot rejoin. This prevents unsafe seat reuse without a transaction but needs a well-specified generation/epoch protocol before broad release.

**G2 — Evidence:** daily counts are explicitly **self-reported** (not verified against Learn/V4). Verified achievements require a trusted server-side assertion/evidence provider. Never label self-reported counts as authoritative FSRS progress or use them to issue honors.

**G3 — Invitation controls:** v1 has no rotate/revoke/expire invite, audit log, or dedicated brute-force rate limit. Add those controls before any public exposure.

**G4 — API & privacy:** HTTP integration and account-deletion cascade intentionally deferred. This is a **pure server kernel** on an isolated branch, not a deployed feature. Mandatory before release: API authorization guard, stable request validation, small response limits, access revocation races, blocked/banned account behavior, OWASP abuse tests, privacy defaults, delete/export policies and jurisdiction-appropriate minor protections.

**G5 — Storage semantics:** confirm EdgeOne Blob conditional-create atomicity, read-after-write consistency, transient error behavior and quotas in a dedicated nonproduction test store. Mock correctness alone is not a live guarantee.

**G6 — Performance:** one Circle read enumerates up to 11 seats; daily progress reads up to 4 immutable objects per participant. Establish request count/latency budgets and introduce compact projections only with safe invalidation.

## Suggested next tranche (no UI changes)

1. Implement trusted account lifecycle/revocation cascade, including ownership transfer or circle closure on account deletion and privacy erasure.
2. Design member generation/epoch and invite rotation with formal/spec state transitions before enabling rejoin.
3. Add server-side evidence verification for achievement sharing and optional Progress V4-derived summary validation.
4. Add **feature-disabled-by-default** REST transport routes with IP/account rate limiting and hard request limits.
5. Complete Blob live concurrency fault-injection gate, then review security and merge readiness separately.
6. Only after sign-off, coordinate with the ongoing UI work for endpoint consumption; never touch its files on this branch.

## Verification

```bash
node --test tests/cloud/circle-core.test.mjs
yarn eslint cloud-functions/_shared/circle tests/cloud/circle-core.test.mjs --ext .js,.mjs
```

The isolated Circle CI workflow runs only on `feature/circle-core-blob` and performs no production EdgeOne deploy. This document is an implementation checkpoint, **not** a declaration that all production gates have passed.
