> **Current product scope (2026-10-13):** [Light social v1](./CIRCLE_LIGHT_SOCIAL_V1.md) supersedes earlier seat/capacity selection, official achievement evidence and whole-circle activity-conflict requirements. Capacity is advisory, shares are self-reported, and private-access safeguards remain.

> **Continuation checkpoint:** [Revocation recovery and retirement cleanup](./CIRCLE_RECOVERY_PRIVACY_V2.md) are implemented as server-only helpers, with 47 passing Circle tests. Production authority, orchestration and live qualification remain blocked.

# Circle event log v2 — executable checkpoint, 2026-10-13

Status: **PARTIAL / isolated kernel implemented / HTTP CLOSED / NOT RELEASE READY**.
Only feature/circle-core-blob. This supersedes historical CAS sections in
CIRCLE_CORE_BLOB_V1.md. No UI, Cloud Sync V4, Maker build, KV or live Blob write.

## Storage and replay

- Server-private social/v2/circles/<circleId>/events/<random-128-bit-eventId>.json.
- Each append attempt allocates a fresh key. setJSON has no conditional options.
  No seats, locks, shared counters, shared index or authoritative RMW.
- Envelope: schemaVersion=2, circleId, eventId, actorUserId, type, operationId,
  payload, dedupKey=SHA256(canonical([circleId,actorUserId,type,operationId])).
- Caller supplies stable creation/progress IDs. Join, clap, achievement, leave,
  remove and close derive stable logical operation IDs.
- A transport failure is circle_append_unknown even if committed; retry the SAME
  logical command. Stale readback never establishes a failed commit.
- Same logical ID/content folds once. Different payloads quarantine the entire
  view and fail closed. This conservative policy has an availability/abuse cost.
- Reads/listing can omit persisted events. Missing creation, known pagination,
  malformed facts and replay-budget exhaustion fail closed. A view NEVER proves
  completeness. Convergence requires eventual visibility of persisted keys.
- Reducer uses bytewise ordering, no locale, clock, arrival order or physical ID
  decisions. Semantic hashes exclude physical duplicates.
- Reducer output is the rebuildable materialized view. No persistent cache or
  background worker is implemented. Cached views cannot authorize access.

## Core semantics

| Operation | Rule |
| --- | --- |
| Create | Stable actor/operation-derived ID, injected server HMAC key for retry-stable invite |
| Apply | Valid invite -> JOIN_REQUESTED -> always pending/final=false |
| Reconcile | Owner + eligible account IDs in lexical order, limited to configured 2..12 in visible view; selected members provisional |
| Leave/remove | Permanent remove-wins; owner cannot leave/remove self; no rejoin |
| Close | Owner-only close-wins, hides all activities and memberships |
| Progress | Self-reported 0..256 newWords/completed; exact day; stable logical-key winner per actor/day |
| Achievement | Injected trusted verifier must return true; one projection per actor/achievement |
| Clap | One actor/target/day; no self clap; visible report and selected participants required |

Late joins may displace provisional members. Capacity is reusable after removal
in the converged view. No hard synchronous admission, irreversible acceptance,
fairness or anti-Sybil guarantee. No MEMBER_APPROVED certificate is emitted.
Progress winner is deterministic, not chronological latest.
getCircle exposes rebuilt members/filtered activities; pending/removed IDs stay
server-side and only counts are exposed. Old HTTP shapes/invite codes are
deliberately incompatible; transport migration is a separate task.

## Identity and privacy

authenticate resolves server session identity. Mandatory trustedAccess.check
must be an INDEPENDENT reliable authority covering actor lifecycle, Circle
lifecycle, action, subjects and viewHash. Anything other than true denies.
Neither a Blob view nor existing authenticate alone implements this authority.

Checks run before/after scans, before/after appends and before private return.
Every exposed active subject must be checked; uncertainty suppresses the whole
private response. Client actorUserId/verified fields are never copied.

Leave/remove/close require trustedAccess.revoke to durably fence access BEFORE
append. A failure emits no event. Lost/failed append never undoes the fence.
The authority must itself authorize at its commit point and be idempotent.
This is an injected contract, NOT a deployed production authority.

Revocation after the last check may still race network delivery. No globally
atomic revoke/read claim: end-to-end fencing/leases or trusted egress must define
that boundary before public exposure.

## Disabled history and offline validation

Historical service/storage remain in *-cas-historical.js but reject construction.
Old blob-storage entry rejects. Original 33 tests are retained as explicitly
skipped circle-core-cas.historical.mjs, not correctness evidence.
HTTP refuses enabled=true; production gateway remains unchanged.

Run node --test tests/cloud/circle-core.test.mjs and repository ESLint over
cloud-functions/_shared/circle and active/historical Circle tests.
47 active tests cover overwriting non-atomic storage, 100 logical retries,
30 joins, delayed displacement, duplicates/permutations, ambiguous responses,
cache loss/rebuild, close/remove/leave, stale revoke/retirement checks,
fence/log failures, identity suppression, malformed facts, key/pagination/
replay-budget denial and list outages. These simulations are NOT live
durability, latency or multi-region certification.

## Safety and launch blockers / exact next work

1. Implement/qualify independent trusted identity/revocation authority and
   account retirement lifecycle without speculative V4 changes.
2. Immutable revocation intents and trusted-receipt replay are implemented.
   Production authority/provider, reliable scheduling, inventory and retry/
   dead-letter orchestration remain unqualified.
3. Retired-account event scrub/residual audit helpers are implemented, requiring
   an independent irreversible retirement fence. Full erasure certification,
   inventory, late-writer settling and retention policies remain unfinished.
4. Review minors/visibility, server-private raw storage and authorship, invite
   brute-force/rate limits, replay limits and conflict quarantine denial-of-service.
5. Qualify isolated nonproduction listing/durability/latency without CAS. No live
   store mutation or deployment was executed or silently authorized here.
6. Hard instant capacity requires separately verified transactional admission.
   Persistent projections, replay efficiency, compaction and HTTP remain future
   work. Historical v1 data is not migrated.

Next developer: qualified trusted authority/provider and inventory/orchestration first;
keep HTTP CLOSED, preserve UI/V4 and protected branches, then qualify live store.
