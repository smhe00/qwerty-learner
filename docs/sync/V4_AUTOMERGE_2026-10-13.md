# QWERTY Plus V4: automatic multi-device reconciliation (2026-10-13)

## Product decision

Ordinary user Sync defaults to **automatic, lossless reconciliation** when
independent devices modify learning records. A conflict is a **verified
integrity/semantic anomaly**, not merely a change to both workspace hashes.

Never silently pick one V4 snapshot, overwrite another, or drop a valid
learning event. Keep explicit recovery/download workflow available even after
merge is enabled.

## Current production constraints (master)

- `v2-policy.ts` detects simultaneous local modification and newer cloud
  revision as `concurrent-edits`; `v2-manual-executor.ts` refuses both push
  and pull. This is correct until a complete reconciliation kernel is gated.
- `wordRecords.id` is a **Dexie auto-increment ID per local database** and
  cannot identify the same event on two machines.
- `wordRecords.timeStamp` and Review replay use **seconds**, then local
  numeric IDs to break ties. Equal seconds are possible even for distinct
  attempts; clock skew can invert wall-clock ordering.
- `achievementEvents.eventId` often embeds local numeric
  `sourceRecordId` (e.g. `word:123`), and
  `chapterRecords.wordRecordIds` / `achievementEvents.sourceRecordIds`
  reference those IDs. A straight table concatenation corrupts referential
  identity.
- The V4 baseline currently stores revision + logical fingerprint, not the
  complete common ancestor snapshot. Old events do not have UUIDs.
- `reviewRecords.acquisitionStates`, incomplete session checkpoints and
  durable `learnRuntime.dailySessions` are control-plane state, not
  commutative counters. Concurrent active sessions must not be concatenated.
- `reviewWordStates` is a derived FSRS-6 state; it must be rebuilt from
  admitted/rated events, never chosen using an arbitrary last-writer-wins.
- `achievementStates` unlock provenance must be preserved and rewired to the
  reconciled event IDs; unlocks must not be rewarded a second time.

## Phase M0: immutable learning-attempt identity (implemented in product/main)

Every NEW `useSaveWordRecord` write receives a random 128-bit UUIDv4
`attemptId` before being inserted. This preserves the existing numeric
primary key for UI/statistics/achievements, FSRS and V4 transport. Compacting
Typing evidence retains `attemptId`. No change to six-table V4 schema or
existing cloud encoding, no rewriting old records, and no automatic merge or
sync overwrite yet.

## Phase M1: read-only three-way conflict classifier (identity gate implemented, full-state gate pending)

For a known prior cloud revision, obtain a verified common-ancestor full V4
snapshot. If a common ancestor cannot be proven, preserve both branches and
require an explicit recovery path for ambiguous legacy attempts. Do not trust
revision numbers alone as a common ancestor proof.

Partition durable word events by `dict` then by `word`. For NEW attempts,
use `attemptId` as identity. Same UUID + equivalent immutable learning
evidence means one event. Same UUID + contradictory primary evidence is a
hard integrity conflict. Different valid UUIDs are distinct events regardless
of equal timestamps. For legacy events, use ancestor-relative occurrence
accounting; a matching word/time/result is NOT sufficient to deduplicate
independent attempts.

An irrelevant UI preference or navigation change must not turn two safe
learning histories into a data-loss conflict. Resolve settings explicitly by
stable policy, e.g. preserve current device presentation settings while
merging account-wide learning data.

## Phase M2: deterministic merge with referential repair (not enabled)

1. Save and verify the local, cloud and common-ancestor snapshots. Perform
   all work on immutable copies under the S1 writer lease.
2. Deduplicate by stable `attemptId`; preserve both genuinely independent
   events, including distinct attempts on the same word.
3. Assign new local numeric primary keys deterministically and rebase ALL
   references: chapter wordRecordIds, event.sourceRecordId/sourceRecordIds,
   achievement state source IDs and derived FSRS shadow sourceRecordId.
4. For each (dict,word) whose Learn evidence differs, sort by validated
   event time and stable tie breaker, then rebuild FSRS-6 from canonical
   accepted ratings. Do not count the same review twice. Guard against clock
   skew and invalid event-time ordering; do not silently rewrite timestamps.
5. Reconstruct achievement event provenance, deduplicate unlocks and
   preserve seen/culture-card state. Validate all event-to-record references.
6. Preserve terminal sessions and recover pending acquisition state without
   resurrecting finished sessions. When two unfinished active sessions have
   contradictory cursors, keep both underlying attempt histories, then
   safely create one new reconciled session rather than splice checkpoints.
7. Validate six-table counts, key uniqueness, referential integrity, FSRS
   replay and stable canonical fingerprint. A second merge must be
   **idempotent and commutative** for learning evidence.
8. Publish by immutable, collision-free per-device/event-batch objects and
   verify their durable receipts and canonical fingerprints. Never rely on
   shared Blob revision CREATE or onlyIfNew as atomic CAS. Materialization
   must be reproducible from all admitted batches and re-checked before
   S1 pre-mount restore; a missing or conflicting receipt blocks publication.
   Recovery retains the exact source snapshots and append-only batches.
9. Do not delete source backups/revisions as part of reconciliation.

## Required simulations before auto-merge rollout

- Three devices, arbitrary interleaving; disjoint dictionaries; same word at
  different times; same second; device clock skew; duplicate retransmission.
- Same attempt ID with different evidence must block.
- Legacy ID collisions and missing ancestor must block ambiguous cases.
- Mixed Typing and Learn histories; different FSRS rating trajectories,
  terminal-probe evidence, hint ladder, manually skipped words.
- Colliding auto-increment IDs in chapter, achievement and review relations.
- Concurrent completed / unfinished daily sessions and reset/exclusion.
- Repeated merge/retry, reordered devices, remote CAS conflict, crash and
  reload recovery. Zero loss of source learning attempts required.

**Not yet enabled**: M1/M2 cloud reconciliation. Until those gates pass,
production continues to fail closed on `concurrent-edits`, as it should.

## M1 implemented scope

The pure `preflightAttemptIdentity` reports per-dictionary new event
counts, shared UUIDs, contradictory evidence IDs, and unresolved legacy rows.
It permits anchored legacy rows ONLY against an explicitly supplied verified
common ancestor, and only if their immutable evidence remains unchanged in
both branches. It is a necessary **event identity** test, not permission to
perform a full V4 merge. The entire six-table merge, FSRS re-evaluation,
achievement re-keying, session repair, remote CAS and S1 journal are **not**
wired to production Sync yet.

## M1.1: per-key conflicts and EdgeOne clock preflight (implemented as opt-in primitives)

**Conflict granularity**: `(dictId, wordName)` is the authoritative FSRS
memory-state key. Different dictionaries (or independent words in one dict)
do not compete for the same FSRS state. Different valid `attemptId` values
within one key represent distinct attempts even at equal timestamps.
However, cross-table references, `dailySessions`, Session checkpoints,
achievement grants, user settings and same-record duplicated IDs still require
whole-workspace reconciliation before any merged V4 can be committed.

**Time source**: QWERTY EdgeOne Cloud Function responds with uncached
`/api/health.serverTimeMs` in UTC milliseconds. HTTP `Date` is not used
for this proof: it is only accurate to seconds and may be added/changed by
intermediaries. Three sequential round trips provide the local/EdgeOne offset
estimate. The current suggested hard preconditions are:
- At least two valid probes; acceptable RTT <= 1500 ms.
- Best probe's |clock offset| plus RTT/2 <= 60000 ms. Offset errors <= one minute are treated as acceptable for FSRS; larger stable skews are corrected in new application learning timestamps.
- Spread between sample offsets <= 2000 ms.
- Auto-merge is **disabled** if origin time capability absent, network slow,
  machine time jumps, offset too large, or origin instances disagree. Normal
  offline learning, local export and pre-existing safe Sync paths are NOT gated.
- The probe never changes the operating-system clock and does not rewrite
  existing historical word timestamps.

**Critical limitation**: current good clock alignment does not prove that
hours/days-old attempts were accurately stamped. New learning events will
need capture-time clock-probe provenance or persisted normalized server-UTC
timestamps, and validation of clock skew/history across both devices.
Historical V4 events without that evidence must not be declared safe based
solely on one fresh probe. Identical seconds remain possible and are not
automatically anomalous: immutable attempt IDs break identity ties; the FSRS
replayer needs a deterministic UUID tie-break before enabling merging.

The additive server field and the client-side proof have been added to the
development branch only. `master` has NOT deployed this capability.
Neither automatic merge nor cloud overwrite is enabled by this change.

## Blocking prerequisite: single-active-session authentication

As of 2026-10-13, `cloud-functions/_shared/core.js` deliberately
authenticates only the latest per-user session. A second login revokes the
first device, and `src/sync/session-revocation.ts` converts its working
account context to anonymous after explicit confirmation. Therefore stable
multi-device auto-merge **also requires an intentional authentication
protocol change**, not merely a new sync merger: multiple independently
revocable sessions per immutable account, per-device tokens and revocation,
bounded expiry/retention, account deletion semantics, and full S1 data
isolation. Preserve defense against session reuse/credential leakage.
Old single-session behavior must stay until this new protocol is tested.
An account-wide password reset should revoke every session.

Two signed-in browser tabs that share the same token are not a substitute
for independently authenticated devices. No multi-device auth change is
implemented in the clock-gate commit.

## Learn startup clock calibration (implemented 2026-10-13)

- While authenticated, entering Learn prewarms EdgeOne /api/health time.
  Starting a NEW Learn session awaits the same deduplicated probe, before
  creating DailySession or preparing FSRS review candidates.
- Three fast samples, each with 1.2s per-request abort; failures do not block
  offline study or fabricate time trust. Anonymous/expired accounts skip probes.
  Refresh every 30 minutes while Learn is open.
- **60-second tolerance**: stable |local/EdgeOne offset| <= 60s is ignored.
  Larger stable offsets shift application learning timestamps via a
  monotonic-anchored clock. OS clock and historical records remain unchanged.
- WordRecord, Learn DailySession preparation, review outcome, and scheduler
  default timestamps share the corrected UTC provider.
- The calibrated epoch anchor is scoped to immutable account ID **and token**.
  Logging out/switching accounts falls back to local time. A temporary offline
  period retains the previously trusted monotonic clock anchor, avoiding an
  abrupt backwards jump after the cache refresh deadline.
- A fresh accurate clock cannot prove old event timestamps were correct; it
  does not authorize any three-way merge or cloud overwrite.
- `master` is not yet deployed with `serverTimeMs`. Legacy EdgeOne
  responses lacking it safely fall back to local time.


## M1 gated implementation — independent device sessions (development only)

- The EdgeOne service accepts \`MULTI_DEVICE_AUTH_ENABLED=true\` as an **explicit opt-in**; absent/false preserves single-active-session behavior. \`/api/health.authMode\` reports the effective backend mode (not rollout readiness).
- An opted-in login/password change writes a separate immutable session record at \`accounts/<usernameHash>/independent-sessions/active/<tokenHash>.json\`. A random 256-bit bearer token supplies the unguessable hash key. Concurrent logins never read or increment the same session version. Existing latest legacy token stays valid during opt-in; already-superseded legacy tokens remain revoked.
- A signed-in device can explicitly revoke **its own** session using \`POST /api/auth/logout\`, which writes \`independent-sessions/revoked/<tokenHash>.json\` as an immutable monotonic marker. Authentication checks the tombstone even when the feature is later disabled. Password change increments account \`authVersion\` and rejects older sessions; deleting an account deletes the independent session prefix before removing identity, with immutable \`userId\` checked on every authentication.
- No session is automatically deleted while its token may still be valid. Authentication enforces the existing 7-day default token expiry; expired records are retained until later account cleanup (garbage collection not yet implemented). Initial registration token is preserved as an immutable legacy session attached to the identity and is eligible for its own revoke marker.
- **Gate not open**: multi-device auth does *not* authorize concurrent ordinary V4 snapshot writes. Until M2 merge and M3 safe upload converge, concurrent V4 writers must continue to block or preserve per-device event history. Existing Blob revision \`onlyIfNew\` is not a reliable atomic CAS. Client account workspace isolation is unchanged.
- **Remaining security work**: current \`getLatestAuth\` is backed by a version listing with eventual-consistency limitations. Strong globally immediate all-device revocation requires a separately verified read/consistency protocol or a storage provider with appropriate guarantees. Neither this switch nor a successful local test proves cross-POP security; keep the switch OFF in production pending Maker fault-injection and revocation tests.


### M1 fail-closed write guard

While \`multiSessionEnabled\` is active, \`putSyncV4\` (ordinary and recovery) raises \`503 multi_device_merge_not_ready\`. Login, local work, GET metadata and cloud snapshot reads remain available. This is intentionally conservative: multi-writer optimistic revision numbers on Blob cannot prove atomic exclusion. **Do not turn on the M1 environment flag on any existing sync-dependent site** before planning this temporary read-only cloud behavior, and do not remove the guard before verified M2/M3 event-reconciliation upload replaces conflicting snapshot overwrites.


## M2.0 UUID-only evidence convergence projection (development, read-only)

\`src/sync/v4-event-convergence.ts\` computes a **pure, deterministic preview**, not a V4 merge:
- Require immutable UUIDv4 on every event, reject identity collisions and non-anchored legacy evidence. Preserve distinct UUIDs even if their local Dexie \`id\` collides.
- Partition by the exact \`(dict,word)\` tuple; sort each history by validated second-resolution timestamp followed by the immutable attempt UUID (not per-device numeric ID).
- Rebuild the existing active FSRS-6 r=0.84 state on ephemeral deterministic numeric IDs. They are throwaway replay inputs, never persisted or used as foreign keys.
- Require commutativity, idempotence, no source mutation, duplicate retransmission and same-second events in regression tests.
- The projection **always** returns \`publishReady:false\`. No historical clock-attestation, six-table referential re-key, achievement graph, active-session resolution, durable merge journal, remote append-only publication, or account-scope proof exists in this kernel. None may be inferred from a successful projection.

**Next M2 gate**: verified common ancestor for legacy attempts, total V4 six-table referential repair, strong event-time provenance, account ownership and deterministic audit of all tables. Do not remove the M1 V4 write guard until then.


## M1/M3 device identity correction

Before M3 event batching, \`browserDeviceId()\` no longer returns a truncated User-Agent (the same on different machines). \`src/sync/device-id.ts\` creates a random UUIDv4 and persists it in the browser profile's origin-scoped localStorage. Tabs in the same profile share the installation ID; different profiles do not. Individual logins still receive independent opaque bearer tokens and server-side session IDs. Browser storage resets create a new installation ID without retroactively relabeling existing event records. Treat \`deviceId\` as diagnostic/routing metadata, **not** proof of authentication or uniqueness across deliberate profile cloning.


## M2.1 reference repair projection (development only)

A pure projection in \`src/sync/v4-foreign-key-projection.ts\` reassigns deterministic
numeric IDs to UUID-addressed word attempts, remaps chapter \`wordRecordIds\`,
word/mastery achievement \`eventId\` and \`sourceRecordId(s)\`, rewires
\`firstTriggerEventId\`, and audits grants. Same numeric IDs from two devices
no longer alias unrelated attempts. Missing or contradictory reference chains
fail closed. No source object is mutated. A stable \`(dict,word,ts,UUID)\` order
makes the word-ID projection independent of ingestion order.

**Important residual ambiguity**: legacy chapter rows have no cross-device UUID.
This projection conservatively retains both copies, which can double-count a
chapter, and never publishes/commits its output. Achievement duplicates with
incompatible unlock state fail closed rather than invent a grant. Full six-table
materialization must solve chapter identity, in-progress \`reviewRecords\`,
derived \`reviewWordStates\`, active \`dailySessions\`, clock attestations,
and robust provenance before it can authorize deployment.


## M3.0 append-only publication pilot (developed, OFF by default)

Only when **both** \`MULTI_DEVICE_AUTH_ENABLED=true\` and
\`MULTI_DEVICE_EVENT_PILOT_ENABLED=true\`, the new authenticated
\`POST /api/sync/events/v1\` accepts up to 32 complete, UUID-bearing word
attempts (96 KiB canonical payload), with an independent per-browser
\`deviceId\` and UUID \`batchId\`. Each payload is canonically SHA-256
addressed at \`users/<immutable-account-id>/event-batches/v1/
<deviceId>/<batchId>-<sha256>.json\`. A replay of identical bytes is
idempotent, and a reused batchId with different evidence produces a
*second* immutable path rather than overwriting the original. The server
checks a read-after-write receipt before acknowledging; network ambiguity
can be retried safely. \`GET /api/sync/events/v1\` retrieves by an exact
\`deviceId,batchId,sha256\` receipt, authenticates the owner and validates
the full content digest. Account deletion removes batch objects.

**No event-list/discovery proof yet.** A receipt verifies one batch, not
that another region/device has observed every committed batch. No V4
restoration, cloud revision CAS, Blob listing completeness, compaction,
FSRS materialization or daily Block auto-upload is enabled by this endpoint.
The existing V4 pilot guard remains active. Expiry/revocation, provenance,
bounded retention and multi-POP test must pass before enabling the flag
even on the disposable test site.


## M3.1 observed receipt catalog (not authoritative)

\`GET /api/sync/events/v1/observed\` lists at most 512 currently observed
batch receipts, detects **visible** reuse of \`(deviceId,batchId)\` with
different hashes, and explicitly reports \`listingIsAuthoritative:false\`
and \`convergenceComplete:false\`. A stale POP may omit a committed object,
so the absence of a receipt or conflict does not prove globally complete
sync. A caller with an exact receipt may still perform an independently
authenticated integrity-checked read. The API is only a verification pilot.


## M2.1a monotonic achievement-seen convergence

For duplicate provenance-identical achievement grants, ordinary \`seenAt\`
and \`cultureCardSeenAt\` observations from multiple devices now converge by
maximum valid timestamp; they are not treated as duplicate unlocks or
hard conflicts. Differences in \`unlockedAt\`, \`firstTriggerEventId\`,
\`sourceRecordId\` or other grant provenance still fail closed.
The projection remains read-only and not restorable.
