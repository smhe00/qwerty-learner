# Circle v3 — seven-day pure Blob design (2026-10-26)

Development implementation; not an etest/production qualification or release. This is API/backend work, with no Circle UI. It supersedes the new-circle storage/product rules in the historical v1/v2 documents. Those documents and their tests still describe the compatibility path for existing QC2 circles. PR #17 was closed as superseded; its branch was retained.

## Product contract

- Pure private EdgeOne Blob in the existing store. No KV, SQL, CAS, mutex, atomic counter or hard seat allocator.
- New circles default to 50 members, including the creator. The existing optional softMemberLimit accepts 2–50. A user may have three active v3 circles including owned circles. These checks are advisory: concurrent admissions may overshoot. Existing members are never displaced.
- Invitation code joins immediately. Membership is a stable object written on join and deleted on leave/removal, with strong readback. Removal is not a permanent ban: the same invitation allows rejoining.
- The owner closes the circle rather than leaving it. Closure is durable and retries do not reopen it.
- Activity is visible only for today and the preceding six **Asia/Shanghai calendar days**. No month/year archive or rollup.
- Self-reported progress merges completion OR and highest newWords, never summing retries. Shares and claps confer no official reward, ranking or learning/FSRS state.
- All HTTP actions retain V4 session validation, trusted source-IP/account limits (60 requests/minute each), bounded bodies/responses and owner/member checks.

## Physical objects

All v3 objects are private and served only through authenticated functions.

| Key below social/v3/ | Purpose / consistency |
| --- | --- |
| circles/C/meta.json | Owner, normalized name, advisory cap, hashed invitation; strong reads |
| circles/C/closed.json | Durable closure; strong reads |
| circles/C/members/U.json | Current membership only; stable write/delete, strong reads and readback |
| accounts/U/circles/C.json | Repairable personal-circle index; strong, never membership authority |
| circles/C/days/YYYY-MM-DD/U/HASH.json | Immutable per-actor activity; ordinary write, eventual reads |
| circles/C/summaries/YYYY-MM-DD/view.json | One replaceable daily summary, source fingerprint and content hash; eventual reads |

Circle IDs are 24 lowercase hex characters. User IDs come from the authenticated session, never request bodies. Activity hashes include the full immutable record. Clap payloads are stable for actor/target/day, so repeated likes overwrite the identical object instead of adding history. Progress eventId identifies a logical operation; conflicting payloads under one logical ID are excluded from aggregation. New valid progress operations may only increase the daily OR/MAX result.

Before control/activity writes, the adapter preserves the existing conservative account-deletion hold at social/v2/accounts/U/used.json. It never edits V4 backup/session/learning objects. Summary writes derive solely from already-held source records. The existing account-deletion hold remains: retention cleanup is not an account-erasure implementation.

## Creation, membership and failure handling

Creation uses a fresh cryptographically random UUIDv4 operationId. Keep it private and reuse the identical ID/input for retries. It deterministically derives the v3 circle ID and QC3 invitation; only an invitation hash is stored. Existing conflicting input is rejected. A retry of an already-existing QC2 creation continues through the old service.

For create/join, the personal index is written and confirmed before the membership object. A failed member write can leave an index without membership: personal-circle listing excludes it, and retrying the same join repairs it. Listing does not delete such an index because the join could still be in flight. Closed-circle indexes are safe to prune because closure is permanent.

Leave/removal deletes the member record, confirms absence, then deletes its personal index. Retrying one's own leave is allowed after the member object has disappeared. Lost responses/readback mismatches produce circle_write_unknown, not success. No automatic blind retry is performed by the backend.

Strong readback confirms the value observed at that point; it is not a transaction or durable promise against subsequent operations. Clients must serialize their membership actions and stop obsolete join retries after leave. The owner explicitly accepts occasional delayed join resurrection and advisory over-cap admission. Concurrent join/leave can temporarily leave a stale or missing index; repeating the intended join/leave repairs its two stable keys. Do not introduce an unbounded event history or revocation generation to resolve these accepted races.

## Daily views and cost

1. List and validate that day's immutable activity keys, consuming bounded pages.
2. Hash the sorted key set and algorithm version.
3. Read the day's single summary. If its source hash/count match, return the summary without GETting individual activities.
4. Otherwise read sources with at most eight concurrent GETs, validate record/key identity, reduce deterministically, and replace the summary.
5. Apply current strong membership to the aggregated result and recheck the requesting session/member/closure before returning.

A new or late-visible activity changes the fingerprint. An older request overwriting a newer summary is safe: the next fingerprint comparison detects the mismatch and rebuilds. Summary writes are cache updates, never authoritative counters or access control. One object per day prevents frequent likes from creating an ever-growing family of aggregate versions.

Historical reads still LIST keys and GET one summary; this avoids repeated raw-object GETs, not all I/O. Membership roster listing uses strong stable keys rather than GETting all 50 member objects. The requester still receives individual membership checks. The seven-day view is a visible-set snapshot, not an atomic global snapshot; ordinary activity may appear after propagation. Removed members' contributions are filtered even from existing summaries, and may reappear on rejoin while still inside seven days.

Read guards: 10,000 activity keys/day, 500 observed membership keys, 1,000 personal index keys, 100 pages/prefix, eight concurrent raw GETs, 8 KiB request body and 64 KiB public response. Malformed/out-of-scope listing, unreadable listed activity, corrupted summaries or exceeded budgets fail rather than silently truncate. These are operational guards, not hard admission guarantees.

## HTTP compatibility and v3 response changes

The action prefix stays /api/circle/v2. Existing create/join/get/leave/remove/close/progress/claps/showcase URLs and body field names remain. No new client credential or deployment secret is required.

- New creation returns a QC3 code and schemaVersion: 3. Membership mutation results carry consistency: strong, readbackConfirmed: true and final: false. final:false reflects possible later/concurrent changes. Activity writes remain eventual; operationKey is a stable content identity, replacing v2 physical append receipts.
- GET /api/circle/v2/mine returns active indexed **v3** circles, role, name, the advisory three-circle limit, and legacyIncluded:false.
- GET /api/circle/v2/C returns current membership and **today's** activity, retainedDays and capacity. It does not return all historical days.
- GET /api/circle/v2/C/days/YYYY-MM-DD returns that day's aggregate.
- The existing /progress/day and /claps/user/day read APIs remain available for each retained day. Outside-window days return 410; malformed days return 400.
- V3 full/day views expose reactionCounts:[{authorUserId,day,count}] instead of the raw v2 claps array. The existing per-target reaction endpoint still returns count. This keeps the full 50-member, 2,450-clap matrix within the 64 KiB response limit.
- Showcase combines deduplicated shares from the seven retained days and respects its existing optional list of up to 24 achievement IDs.
- HTTP mutation status remains 202; GET remains 200. The envelope consistency follows the result when specified.

QC2 invitations and existing v2 IDs route through the unchanged legacy event service; no data migration, conversion, expiration or deletion happens there. Legacy circles retain their old permanent-revocation/history behavior. Personal-circle discovery and the three-circle/50-member/seven-day rules apply to v3 only; legacy data has no personal index. Any future legacy migration needs a separate reviewed task. Legacy retry defaults are preserved.

## Scheduled maintenance

The backend rejects expired days regardless of cleanup timing. Physical expiration is performed by scripts/circle-v3-maintenance.mjs; it is **not provider-native TTL**, so bytes remain until a sweep runs. This script traverses inactive as well as active v3 circles. It never deletes v2 data, metadata, closure, memberships, indexes, account holds or current-day-window objects.

Provide CIRCLE_PROJECT_ID, CIRCLE_BLOB_TOKEN and CIRCLE_BLOB_STORE privately in the scheduler environment. Keep credentials out of arguments, logs and repository files. Store checkpoint files outside the repository, separately for dry-run and execute modes.

Dry-run example (read-only remote operations):

    node scripts/circle-v3-maintenance.mjs --state <private-dry-run-checkpoint.json>

Deletion after staging qualification and release approval:

    node scripts/circle-v3-maintenance.mjs --execute --state <private-execute-checkpoint.json>

Each invocation processes at most 20 listing pages and 200 candidate deletions. Reinvoke with the same checkpoint until complete:true. A completed checkpoint contains null; the next scheduled invocation starts a fresh sweep. Use one worker per checkpoint. An hourly scheduler can run bounded invocations with backoff until complete, while logging only the sanitized summary. The scheduling environment must run independently of users visiting the circle.

Directory pages are enumerated before deleting their children. An expired activity partition is drained from its first page after each delete batch, so offset-based cursors cannot skip records as objects disappear. Dry-run uses cursors without mutation. This works even when an expired partition exceeds the API's read budget. A crash/lost DELETE response safely repeats deletions from the last checkpoint. Every checkpoint is scope/date validated before operations. Later full sweeps catch late-visible objects; complete:true is a traversal result, not a physical-erasure/privacy proof.

No scheduler was installed and no live Blob objects were touched during development. Before release, qualify exact-SHA Cloud/Blob behavior on etest (including strong read/delete confirmation, eventual source visibility, paging and maintenance), then provision the scheduled cleanup as part of the authorized rollout. Local memory-store tests do not qualify the provider.

## Validation

See interactive/reports/CIRCLE-BLOB-SEVEN-DAY-20261026-report.md for exact evidence. Focused tests include membership retry/rejoin, advisory concurrency, partial writes, session revocation, cache invalidation/stale overwrite, 50-member reaction response size, Beijing midnight, source integrity, cursor validation, legacy compatibility and restartable cleanup beyond the read budget.
