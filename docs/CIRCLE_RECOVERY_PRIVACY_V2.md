> **Current product scope (2026-10-13):** [Light social v1](./CIRCLE_LIGHT_SOCIAL_V1.md) supersedes earlier seat/capacity selection, official achievement evidence and whole-circle activity-conflict requirements. Capacity is advisory, shares are self-reported, and private-access safeguards remain.

# Circle v2 — revocation recovery and retirement cleanup

Checkpoint: 2026-10-13, isolated feature/circle-core-blob, HTTP CLOSED.
This extends CIRCLE_EVENT_LOG_V2.md. It adds executable maintenance helpers,
not a production authority, scheduler, account-deletion integration or deployment.

## Revocation protocol

Normal leave/remove/close now runs:
1. Validate the server-resolved actor and current owner/member permission.
2. Append a unique-key REVOCATION_INTENDED event containing the canonical final
   command. Logical retries deduplicate. Intent alone has no reducer effect.
3. Call independent trustedAccess.revoke with the current token, proof, canonical
   command, stable operationId and commandHash. The authority must validate
   permission at its own commit point, fence access idempotently and preserve a
   durable exact receipt. No token is stored in the Blob intent.
4. Independently lookup the bound receipt, then append the final leave/remove/
   close event. The already-fenced actor is not granted a new private read.

Unknown intent append means do NOT attempt the fence. A lost fence response is
circle_revocation_unknown: the fence may have committed; do not infer otherwise.
A final append failure leaves the acknowledged intent available for recovery.
No lock, CAS, shared cursor, counter or authoritative RMW is introduced on Blob.

createCircleRevocationCoordinator({ log, trustedAccess }).recover(circleId):
- Requires independent maintenance authorization before scanning and each append.
- Groups visible intents by logical key; malformed/conflicting intents are blocked.
- Only replays a canonical command confirmed by the independent authority.
- Null receipt means not committed/deferred; undefined, mismatched receipt or
  authority outage fails closed.
- Receipt must match both operationId and hash of the exact actor/circle/type/
  logical operation/payload; it cannot authorize another command.
- A missing final event can be replayed into a new physical key. Concurrent
  workers and stale listings may emit duplicates, handled by reducer dedup.
- Per-command maintenance policy receives subjects and commandHash and MUST deny
  replay for retired accounts to avoid recreating deleted identity references.
- Returns counts, snapshotOnly=true, fullyRecovered=false. An empty or partial
  scan does not certify completion. Repeated invocation is needed.

Trusted authority receipt shape: status="committed", operationId, commandHash.
lookupRevocation accepts operationId/commandHash. Receipt existence must imply a
durable access fence, not merely a request accepted into an eventual Blob log.
The production provider still needs independently proven reliability. Old
boolean-only revoke implementations now fail closed without receipt lookup.

## Retirement cleanup

createCirclePrivacyMaintenance({ log, trustedAccess }) exposes only server-side:
- auditAccount(circleId,userId): schema-aware current-scan residual counts.
- scrubAccount(circleId,userId): deletes visible event objects authored by or
  referencing that retired identity, then audits again.

Every deletion requires independent maintenance permission and the same reliable
irreversible retirement fence. lookupRetirement({userId}) must return exactly
the requested userId, status="retired", and a stable nonempty safe fenceId.
Missing authority, active account, mismatched identity, changed fence or revoked
maintenance permission stops work. Delete failures are thrown and can be retried.

Records covered: actor-authored create/join/progress/achievement/clap/final
revocation events, clap/removal targets, and nested actor/target references in
revocation intents. Account IDs must never be reused after retirement.
An owner retirement removes owner-authored creation; the Circle becomes
unavailable. No replacement owner or authority is inferred from leftover data.

Physical deletion is a deliberate retention exception to ordinary append-only
commands. It cannot revoke access itself; the independent fence remains the
source of that security decision. The remaining event set no longer reconstructs
erased identity facts, and stale replicas cannot be trusted to reconstruct access.

Delete acknowledgement is NOT proof that replicas/late writers are clean.
Reports always include snapshotOnly=true, fullyErased=false, followUpRequired=true.
Repeated cleanup catches delayed visibility and pre-retirement accepted writes.
This is not a jurisdictional erasure certificate or free-text personal-data
classifier. A complete circle inventory, trusted orchestration, dead-letter
handling, independent cache invalidation and residual retention policy are still
required. No live data was deleted.

## Executed gates and remaining boundary

47 Circle tests pass, including all earlier core tests plus crash/restart,
100 concurrent recovery workers, lost intent/fence/final responses, forged/
misbound receipts, maintenance privilege loss, delayed intents, retirement
cleanup across actor and target references, stale delete acknowledgements,
late writers, owner retirement and namespace safety. ESLint is required clean.

Still blocked: real trusted identity/fence/receipt/retirement provider; production
worker scheduling/inventory and retention proof; actual Blob listing/durability/
latency qualification; privacy/minor policy; HTTP migration and abuse controls.
No hard instantaneous member cap or atomic revoke/response-delivery guarantee.
HTTP remains unmountable, UI/V4 and product/main/master remain untouched.

Next developer: implement a separately qualified trustedAccess provider and
trusted inventory/orchestration in an isolated test environment. Maintain the
current offline gates; never substitute eventual Blob/KV state for receipts,
retirement or maintenance authorization.
