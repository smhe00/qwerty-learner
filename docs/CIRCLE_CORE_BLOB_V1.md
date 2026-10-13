> **2026-10-13 implementation checkpoint:** [Circle event log v2](./CIRCLE_EVENT_LOG_V2.md) is implemented on the isolated feature branch. CAS kernel and HTTP enabling are disabled; historical code/tests are retained as disabled artifacts. The eventual-consistency decision below remains binding.

# QWERTY Circle Core — Blob-only Kernel (S0 / first implementation)

> Branch: `feature/circle-core-blob`
> Baseline: `product/main` at `c2e8cbbb4d7a6509b956c36e4245bfab122abfea`
> Deployment status: **NOT EXPOSED / NOT RELEASE READY**
> Contract owner: Circle backend; separate from Learn, Typing, FSRS, cloud V4, UI.


> **CURRENT ARCHITECTURE DECISION (2026-10-13) — supersedes all CAS-based assumptions below.**
>
> Circle MUST be implemented and evaluated as an **eventually consistent system with NO assumed atomic write primitive** on either EdgeOne Blob or EdgeOne KV. Neither service may be used as a distributed mutex, exclusive seat allocator, atomic counter, put-if-absent, or CAS commit point.
>
> **Evidence boundary:** Blob `onlyIfNew` was observed to overwrite existing keys in external Token-mode live tests; see [live findings](./CIRCLE_BLOB_CAS_LIVE_FINDINGS_20261012.md). KV's atomic/consistency API behavior has **not yet been established by an executed KV write test**. For Circle design we intentionally impose the same *no-CAS, eventual-consistency* contract on KV until an independent live capability test proves otherwise. This is a **design constraint**, not a claim that all EdgeOne KV reads are officially documented as eventual, or that KV lacks atomic primitives in every possible product configuration.
>
> **Status:** the existing Blob seat reservation implementation, CAS-dependent invite rotation, per-day slot allocation, quarantine tombstones and the passing mock tests are retained solely as **historical experimental code**. They do not establish production correctness. Circle HTTP remains disabled; no release or merge until a new non-CAS design passes consistency, authorization, deletion and fault-injection gates.

## Storage consistency contract — binding for all future Circle work

| Topic | EdgeOne Blob | EdgeOne KV | Circle requirement |
| --- | --- | --- | --- |
| Atomic create / `onlyIfNew` | Failed external Token-mode live probe; not trustworthy for Circle | Not verified; **assume unavailable** | No conditional-create locks or exclusive-seat CAS |
| Cross-key transactions | No supported guarantee for Circle | No supported guarantee established | Never rely on read-modify-write across keys |
| Concurrent same-key writes | Can overwrite | Conservatively assume overwrite / last-writer behavior | Use unique event keys; never contend on shared authoritative state |
| Reads / listing | Provider can offer strong object reads in some paths; no atomic multi-key snapshot assumed | No product-specific guarantee asserted yet | Treat read models and listings as potentially stale or incomplete |
| State convergence | Requires application-defined merge | Requires application-defined merge | Deterministic replay/merge, retries, reconciliation |

**Allowed model:** immutable, unique-key events (e.g. random 128-bit identifiers plus actor and idempotency key); server-validated authorship; deterministic fold of an eventually complete event set; rebuildable projections in Blob and/or KV. Avoid rewriting an authoritative `members.json`, `seat-05.json`, `likes.json`, or `latest.json` as a concurrency control mechanism. A stable logical idempotency key may deduplicate duplicate events during aggregation, **but cannot prevent physical duplicates at write time without a proven uniqueness primitive**.

**Capacity semantics:** a cap such as 12 active members cannot be synchronously enforced using only eventual reads and non-atomic writes. Mark joins **pending** until a deterministic reconciliation rule (e.g. tie-break by server-issued sortable event fields, with a stable eventId tie-break) selects admitted members. Never show a provisional join as irrevocably accepted. If a *hard, instantly enforceable* 12-member cap is required, introduce an independently verified transactional admission service instead of pretending this storage model guarantees it.

**Security is NOT merely eventual:** membership revocation, account deletion and visibility of minors' data cannot rely solely on a stale projected view. Require server-side authorization using an appropriate reliable identity/revocation control; fail closed during uncertainty, suppress private reads, and use tombstones plus auditable physical cleanup. "Eventual consistency" does not authorize temporary leakage or incomplete erasure.

**Acceptance gates for the replacement kernel:**
1. Two writers joining at capacity; replay outcome converges and no unauthorised membership is exposed.
2. Same actor retries an event 100 times; projections count it exactly once.
3. Out-of-order, delayed, duplicate and partially visible events converge to the same result.
4. Revocation during an in-flight read and account retirement cannot expose protected records.
5. Loss of view cache can be recovered from events without lost facts.
6. Live non-production KV/Blob CRUD and latency checks; **never** infer atomicity from a mock.
7. No changes to `src/`, `product/main`, `master` or Cloud Sync V4 as part of this isolated work.

---

## Purpose and boundaries

**Historical V1 implementation:** QWERTY Circle is a **shared social data domain** initially prototyped on the existing EdgeOne Blob store. The binding new design assumes non-atomic, eventually consistent Blob/KV (see decision above). Personal account/workspace data stays in `accounts/` and `users/` and is never copied into Circle records. Circle keys use `social/v1/` exclusively.

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

1. **HISTORICAL / INVALIDATED:** Blob `setJSON(...,{onlyIfNew:true})` was assumed to reserve seats. **Live external-mode testing disproved this assumption. Do not reuse this as a Circle guarantee.**
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

---

## Iteration 4 — privacy race defenses, auditability and live-Blob contract harness

**Scope:** isolated `feature/circle-core-blob` only; server backend, nonproduction probe, tests and docs; UI untouched.

### Privacy security review

The authorization check at the beginning of a request is not sufficient if an owner removes a member or the member's account is quarantined while expensive Blob reads are underway. This iteration adds end-of-request authorization checks to member metadata, clap and showcase endpoints; clap counts now exclude authors who were revoked during a concurrent read. Dynamic probes deliberately pause the underlying Blob read, revoke/quarantine the target, then resume. No private achievement may be returned after revocation in the tested interleavings.

These guards mitigate tested races, but cannot provide a globally atomic authorization/read transaction across requests. Release certification requires review of the overall consistency assumptions and the actual EdgeOne runtime.

### Scoped storage and retired-account audit

- All Circle Blob storage operations now validate relative path segments, forbid `..`, `.`, duplicate separators, backslashes, control characters and non-approved characters. Prefix list inputs can end with a single trailing slash, and access stays under `social/v1/`.
- Trusted backend `auditRetiredAccount(userId)` requires a durable quarantine marker, then reports `activityObjects` still present and a separate count of `structuralReferences` (reverse indexes, seats, owner metadata and disabled marker).
- The audit is a **momentary strong-list snapshot**. It always returns `snapshotOnly:true`, `fullyErased:false` and `followUpRequired:true`. A concurrent pre-fence writer can still commit an object after the audit.
- `auditRetiredAccount`, `quarantineAccount` and `scrubAccountActivities` must never be exposed as ordinary client-controlled API endpoints.

### Optional real EdgeOne Blob storage contract

Added `scripts/circle-blob-live-contract.mjs`, deliberately **NOT invoked** by automatic CI. The isolated Circle Gate runs `node --check` plus ESLint only.

The probe must be run manually, with a separately provisioned **nonproduction** EdgeOne Blob Store whose name ends in `-circle-sandbox`; it refuses the production `qwerty-data` name and requires an explicit opt-in string. It performs four rounds of 48 simultaneous `onlyIfNew` attempts against one key, alternating two SDK Store clients, then verifies a single successful writer, strong read/list and deletion. It uses random run-scoped keys and attempts cleanup even if an assertion fails.

Only in an approved nonproduction environment, provide these environment variables privately (NEVER place them in the repository or a chat):

```text
CIRCLE_BLOB_LIVE_ACK=RUN_CIRCLE_SANDBOX_ONLY
CIRCLE_TEST_BLOB_STORE=<dedicated-name-ending-in-circle-sandbox>
CIRCLE_TEST_PROJECT_ID=<nonproduction Makers project ID>
CIRCLE_TEST_API_TOKEN=<nonproduction scoped token>
```

Then run `node scripts/circle-blob-live-contract.mjs` locally or in an expressly isolated manual workflow. Do not run against a production Maker project or the main backup Blob Store.

Even a successful probe demonstrates only the documented single-process, two-client conditional-create/strong-read contract. It does NOT establish geographically distributed transactional linearizability, nor account-deletion physical-erasure correctness. No actual EdgeOne live probe has been executed in this feature branch in this iteration.

### Remaining launch blockers

1. **Account deletion is not integrated** with the existing backend `deleteAccount`; identity-containing seats/indexes/ownership metadata are not physically removed. Activity deletion can race pre-fence writes, so a one-pass clean result is not sufficient.
2. The authenticated HTTP adapter is not mounted in production and remains disabled; mandatory per-source-IP + account rate limiter implementation is still needed.
3. Achievement verification requires trusted server evidence independent of self-reported counts.
4. Real EdgeOne sandbox test result must be recorded, followed by a separate multi-region behavior assessment.
5. Full privacy compliance, retention policies, performance budgets and UI integration require approval before any merge/release.

**Deployment remains prohibited:** no merge to `product/main`, no `master` update and no EdgeOne Maker build triggered by this work.

---

## Next development direction — replace CAS-dependent Circle kernel

1. Freeze the current experimental `cloud-functions/_shared/circle/service.js` APIs as **not production-correct** until migrated away from seat/CAS allocation; the current 33 mock tests verify an imaginary create-only contract and must be replaced or supplemented with eventual-consistency fault tests.
2. Define an immutable event schema for `CIRCLE_CREATED`, `JOIN_REQUESTED`, `MEMBER_APPROVED`, `MEMBER_LEFT`, `MEMBER_REMOVED`, `PROGRESS_PUBLISHED`, `ACHIEVEMENT_SHARED`, `CLAP_ADDED` and `CIRCLE_CLOSED`, with schema version, immutable `eventId`, actor identity, logical operation id and deterministic conflict ordering.
3. Implement a pure, deterministic reducer; membership, progress and reaction projections must be disposable caches, never the source of truth. Verify convergence under reorder, dedup, delayed listing, retries, crashes and partial outages.
4. Use KV (if CRUD is verified) for **small materialized views / hot reads**, Blob for **immutable archival events and larger snapshots**; neither is an authoritative atomic lock. Choosing KV over Blob is a performance/cost/read-path decision, not a substitute for CAS.
5. Keep privacy/account revocation behind fail-closed authoritative access checks; never permit an older eventually consistent snapshot to re-grant access. Provide retryable erasure with residual auditing.
6. Coordinate with separate UI work **only after** the event schema, eventual-consistency invariants and REST contract are reviewed. Do not deploy or merge automatically.

**Engineering decision:** No atomic write is assumed for EdgeOne Blob or EdgeOne KV; Circle correctness must not depend on one. The Blob failure is measured; the equivalent KV constraint is deliberately conservative pending real KV tests.
