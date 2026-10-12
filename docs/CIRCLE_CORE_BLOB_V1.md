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

---

## Iteration 2 — independent backend continuation (2026-10-12)

This section overrides superseded details above without rewriting the initial implementation record.

### Changes delivered

- **Admission single-writer CAS:** the original fixed-seat implementation did not prove same-account concurrency; two identical callers could interleave and occupy two seats. A per-user immutable `join-claims/<userId>.json` record now elects exactly one seat allocator. Other callers can see an already committed seat or receive a safe `409 join_in_progress` while it commits. No time-based lock stealing is permitted.
- **Progress event idempotency CAS:** the original four daily slots could absorb duplicate simultaneous event-ID publications. `progress-claims/<userId>/<day>/<eventId>.json` selects one publisher; pending concurrent duplicates receive `409 progress_in_progress`.
- **Reverse membership index:** `user-circles/<userId>/<circleId>.json` is durably written before any Circle metadata or seat claim becomes active, allowing later account lifecycle processing to enumerate all potentially visible memberships, including interrupted joins.
- **Account quarantine:** the trusted server-only `quarantineAccount(userId)` creates `accounts-disabled/<userId>.json`; actor methods deny access, other members cannot see that user's progress, and owner quarantine makes the owned circle unavailable. This is a privacy **access fence**, not physical erasure or production account-delete integration.
- **Invite rotation:** `rotateInvite(token,circleId)` is owner-only, CAS-gated with immutable `invites/01..08.json` revisions. Only the latest secret is accepted for new joins, and existing memberships survive rotation. In-flight joins whose validity check preceded rotation may still complete; strict instant cancellation is **not** claimed.
- **HTTP transport contract:** `createCircleHttpHandler` in `cloud-functions/_shared/circle/http.js` is **not registered** with the existing EdgeOne gateway. It defaults disabled, requires an injected source-IP/account rate limiter before it can be enabled, validates Bearer tokens and bounded JSON bodies, emits no CORS headers, and exposes no account-quarantine endpoint. The gateway must enforce its own CORS and authentication error handling if integration is later approved.
- **Tests:** deterministic in-flight join/progress barriers, account quarantine, scoped strong listing, route authentication/size/rate limits and invite rotation concurrency. The exact CI status for the latest revision is authoritative; passing older runs does not prove later revisions.

### New storage keys (all prefixed `social/v1/`)

```text
accounts-disabled/<userId>.json
user-circles/<userId>/<circleId>.json
circles/<circleId>/join-claims/<userId>.json
circles/<circleId>/progress-claims/<userId>/<YYYY-MM-DD>/<eventId>.json
circles/<circleId>/invites/01.json ... 08.json
```

### Mandatory release blockers remain

1. A crashed elected writer can leave a permanent pending claim; automatic recovery needs proven fencing semantics or a transaction-capable substrate. Neither safe rejoin nor safe slot reuse is implemented.
2. **Physical privacy erasure is not implemented.** Account quarantine only prevents API visibility. Linking it to the actual account deletion transaction, removing retained per-user objects/reaction references, and proving retryable partial cleanup are required for public rollout.
3. The achievement proof callback is not backed by a trusted server-side Learn evidence source; self-reported progress is not verified for reward purposes.
4. A real authenticated gateway integration, explicit feature-flag rollout and deployed Blob atomic-create race tests are outstanding. The separate HTTP adapter must stay detached until these Gates pass.
5. The 8-rotation bound, lifetime seat limit and current 4 daily updates need UX/product sign-off before wider Circle use.
6. The complete branch remains isolated from `product/main`, `master` and all frontend assets; never merge or deploy automatically.

---

## Iteration 3 — crash recovery and quarantined activity cleanup (2026-10-12)

**Status: implemented in isolated Circle branch; production disabled.**

### 1. Recovery correction: avoid permanent orphan claims

The earlier per-user `join-claims` and per-event `progress-claims` approach introduced a liveness defect. If the elected writer crashed after creating the claim but before writing the seat/report, all later callers could encounter an orphaned `409 in_progress` state forever.

The current kernel **does not create these claim objects**. Instead, every contender scans one deterministic ascending sequence of immutable seat/report slots. Each slot is read strongly, allocated with atomic `onlyIfNew`, and — on a losing create — reread before scanning any later slot. If another request committed the same account or event, all contenders return the existing result.

Properties under **atomic create-only, linearizable strong-read assumptions**:

- A user never occupies two seats in one Circle; capacity never exceeds 12.
- Two concurrent reports with the same `eventId` cannot consume two daily slots.
- A pre-write crash does not reserve a seat/event indefinitely; retry can proceed.
- A committed write with a lost transport response can be recovered by read-back.
- The account reverse index still precedes any committed seat, including on retry.
- No time-based lease takeover, force reset or unsafe deletion of stale reservations is used.

Tests include blocked in-flight writers, repeated concurrent same-account admissions, 30-account admissions, and pre-write failure followed by retry. Earlier historical `*-claims` keys are not read or created by current code. These are development-only records; no production migration is needed because Circle endpoints have never been activated.

**Do not claim this algorithm is proven on the live EdgeOne Blob implementation** until a genuine simultaneous-create/read-after-write test validates the required atomic guarantees.

### 2. Quarantined account activity scrub

New internal operation: `scrubAccountActivities(userId)`. It **must only be called from trusted account lifecycle code** and is not exposed in `http.js`.

It first creates the durable, permanent `accounts-disabled/<userId>.json` fence; then uses pre-commit reverse membership indexes to enumerate all related circles. If the account owns a circle, it creates a `closed.json` tombstone.

It attempts to physically delete these narrowly scoped record categories:

- All progress entries authored by that user.
- All achievement showcase entries authored by that user.
- All reactions sent by that user.
- Reactions sent by other currently or historically seated members **to** that user.
- Any obsolete progress-claims objects, should historical test records exist.

`createCircleBlobStorage.remove(key)` performs a scoped, retried Blob `delete` followed by a strong-read verification. Failure throws rather than claiming success; rerunning the scrub is idempotent. A false / incomplete result is not disguised as a completed account erasure.

**Explicit limitations:**

- The result always returns `fullyErased:false, followUpRequired:true`. It does **not** erase immutable seating/ownership identities, audit references, reverse indexes or disabled tombstones. Storage still contains identifiers.
- Even if a scrub pass returns, an earlier in-flight writer may commit an object afterward. A deterministic regression test proves this race and verifies that a **second scrub** clears the residual, while the quarantine fence has continuously prevented read access.
- Guaranteed *physical* erasure requires a proven writer-quiescence/fencing mechanism plus repeatable convergence/auditing, or a transactional backend. No such guarantee is made by this branch.
- Existing `deleteAccount` remains unchanged. No Circle action is hooked to live account deletion. Thus user-account deletion lifecycle is **not** production-integrated.

### 3. Verification and deployment discipline

The feature-specific Circle Core Gate executes kernel contract tests and lint without changing any frontend files or EdgeOne Maker deployment. The latest commit's exact GitHub Actions result is authoritative. Previous tests passing does not imply final production readiness.

Release blockers still include:

1. Backend `deleteAccount` orchestration and a **true physical identity erasure** strategy;
2. A live non-production Blob strong-read / conditional-create concurrency proof;
3. Trusted achievements evidence (local Backup V4 data is not itself proof);
4. IP/account rate limiting and gateway integration under an explicitly enabled feature flag;
5. Privacy policies, minors safeguards and retention boundaries;
6. Performance budget for multi-key Blob reads;
7. Genuine UI integration only after coordination with the separate UI team.

**Do not merge to `product/main`, push `master`, or enable Circle HTTP until these gates have independent approval.**
