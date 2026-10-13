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
8. CAS a new server revision based on verified latest remote revision,
   recheck the result SHA+logical fingerprint, stage it in crash journal,
   and restore it to the current workspace through the S1 pre-mount
   recovery path. A CAS failure means read the latest cloud revision and
   re-plan; never retry a stale write.
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
