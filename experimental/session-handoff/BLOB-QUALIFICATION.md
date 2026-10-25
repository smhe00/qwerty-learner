# Blob-backed account handoff: etest qualification, not production enrollment

## Scope

Owner asked to complete account/session handoff, not choose or migrate a database.
This implementation uses the existing Blob service for payloads and a separate
qwerty-handoff-qualification coordination namespace. No CAS, PostgreSQL runtime,
process-global mutex, lease expiry or TTL-based takeover is used.

Only NEW randomly generated accounts matching ^qh26[0-9a-f]{24}$ are enrolled.
The stored normalized username selects bearer requests. Request Origin/Host
headers cannot enable, disable or fork coordination. Maker internal URLs are
supported. Existing accounts are not enrolled. Do NOT release this branch to
master as general handoff protection.

## Protocol and required assumptions

Each invocation owns fresh immutable unique keys for intent, ticket, entry and
completion/cancellation. Intent is published before ticket choice. A COMPLETE
strong single-page list supplies membership and phase evidence from key names.
Order is (ticket, uuid). Admission waits for choosers and lower-order live
participants. A handoff intent makes waiting/new writers cancel before work.
Admitted HTTP requests drain all Blob mutations including multipart staging,
commit cleanup, auth changes and activity bookkeeping. New login is returned
only after the old operation and its terminal receipt complete. Credentials are
validated before admission and revalidated under ownership.

Pairwise argument: if P's final strong membership scan, after publishing its
ticket, does not see Q, Q must register later. Q's ticket choice then sees P's
published ticket and cannot overtake it. Visible contenders wait for unfinished
choices and compare fixed tickets; UUID order breaks ties. Completed contenders
need not be waited on. Terminal markers cannot precede completion of issued
business writes. Timeout cancels ONLY the waiting contender. Unknown mutation
outcomes remain nonterminal and block takeover.

REQUIRED: globally strong exact-key reads AND complete strong single-page lists,
durable acknowledged writes, no external deletion of coordination receipts.
Eventual consistency does not satisfy this protocol. Malformed/truncated pages,
forgotten known participants and unverified writes fail closed. The finite
negative-control test shows incomplete/stale membership breaks exclusion. A
successful live run cannot prove provider consistency universally.

Primary references:
- https://pages.edgeone.ai/document/blob-storage
- https://lamport.org/pubs/pubs.html
- https://lamport.azurewebsites.net/tla/boulangerie.html

## Whole-request enforcement

The public onRequest delegates to withHandoffGateway. The private uncoordinated
dispatcher is never independently routed. All business getStore calls are
instrumented through AsyncLocalStorage, which is tracing, NOT the mutex.
Every issued write is awaited, including errors swallowed by higher-level
cleanup. Uncertain mutation leaves a nonterminal participant. Detached writes
after scope closure are refused before provider submission. A failed auth body
classification MUST NOT fall through to unguarded login even if a second read
could succeed. Status is bearer-authenticated, read-only and never touches idle
activity. Single-session logout verifies a token tombstone under the same gate.

Circle/admin/global-maintenance routes are refused for qualification accounts.
Executing idle cleanup must stay OFF. Ordinary-account behavior is retained;
this is not complete social/maintenance rollout.

## Bounded qualification only

At most 128 operations per fixture and one complete list page are allowed.
Receipt histories are NEVER pruned. Capacity/pagination failure refuses work.
A crash or unknown write may strand a disposable account. No force reset or TTL
unlock exists. This is not acceptable final user-facing availability behavior.
General rollout still needs bounded persistent history/recovery, qualified
provider semantics, social/maintenance coverage and an old-code cutover plan.

Authenticated fixture header X-Qwerty-Handoff-Hold-Ms (0..5000) pauses manifest
publication and writes a diagnostic checkpoint. It grants no authority. The live
test must observe a held writer AND pending handoff or FAIL as inconclusive.

## Validation and publishing

Tests use exact backend/Blob adapter; gateway tests bundle the real public
handler, replacing only provider I/O. Three independent OS processes share only
HTTP get/set/list. The finite three-contender model includes cancellation and a
negative control for incomplete membership.

The reviewed gateway-wiring.patch is applied to pinned original blob hashes by
the feature qualification workflow, committed as actual source, merged with
upstream product/main without forcing, and tested before the feature is pushed.
This addresses local Git network unavailability without exporting credentials.
The workflow NEVER pushes staging or master. Its artifact identifies the exact
tested resulting commit; the triggering SHA is not necessarily that commit.

session-handoff-live.yml runs only on edgeone-test, pins deployed source SHA,
rejects production origins, creates a random new fixture and verifies held A,
B waiting, old-write rejection, exact A data at B, union payload, logout and C
login. Only known clean synthetic accounts are deleted; uncertain ones remain
without forced unlock. Coordinator receipts remain as audit evidence. No user
credentials are logged. Passing staging qualifies this pilot, NOT existing users.
