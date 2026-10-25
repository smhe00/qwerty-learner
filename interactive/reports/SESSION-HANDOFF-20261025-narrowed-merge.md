# Narrowed session-handoff integration

Owner direction: stopped execution is sufficient, regardless of business
success. Do not block takeover on a required successful resync. Historical
request-body transport errors are separate, not a blocker for this scoped merge.

Execution base: ba987ca9af7bece0683beb3870a8061013b624ad.
Inspected product/main: dd30e54ac77c7bb43228f0207365e92c98033d78.
The existing independent CURRENT_TASK is preserved. Native Git fetch failed DNS;
repository reads and publication use the authenticated GitHub connector.

## Change

runHandoffScope now captures an application exception, drains dispatched writes,
closes the scope and emits a server-internal StoppedOperationError only when no
provider mutation failed. The Blob barrier records ordinary execution completion
and rethrows the original error. A remains failed; B need not wait for resync.
Late attempts through A's closed storage proxy are refused before provider I/O.
Existing done-done receipts mean execution completion, not upload success;
there is no new receipt format, TTL, retry or cleanup algorithm.

If ANY provider mutation rejected, the result remains uncertain even if the
handler catches it or throws a different business error. A missing terminal
receipt also cannot release the barrier. This is not server-crash recovery.
No frontend, local workspace, event merge or pending-upload behavior was changed.
No PostgreSQL changes, historical body-receive fix, live account enrollment or
master deployment occurred in this increment.

## Focused validation

Local Node22.16.0: session-handoff-stopped.test.mjs PASS6/6, zero failed/skipped.
Exact production scope and Blob barrier, only provider I/O simulated:
1. Failure before writing preserves A error and admits B.
2. Failure after acknowledged progress drains a pending effect before B; new
   A work refused during drain; closed A cannot overwrite B afterward.
3. A returned HTTP503 remains503 while allowing the next handoff.
4. A caught provider-write rejection cannot release ownership.
5. Unknown write takes precedence over a later application exception.
6. Unverified completion receipt cannot produce a successful takeover.
Syntax checks for changed production JS passed. Existing qualification workflow
adds the six tests without deleting or weakening prior assertions. CI and merge
results will be recorded after they complete, not inferred from local passes.

## Explicit limits

Integration into product/main is authorized, ordinary-account activation and
production release are not claimed by merging. The reserved-account selector
and existing bounded pilot are unchanged. Historical live PASS evidence covers
runtime34a3d15 only; this new behavior is not yet certified by a live run.
The broader historical V4 failures remain retained and unresolved; no gate is
relabeled green. The owner's narrowed acceptance avoids bundling their root-
cause fix into this task. User data and independent upstream work stay intact.
