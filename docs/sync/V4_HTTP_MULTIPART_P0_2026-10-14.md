# P0: bounded HTTP V4 upload, no Backup V5 (2026-10-14)

## Root cause

The EdgeOne Blob adapter already chunks stored revisions, but browser Sync V2
previously sent the entire gzip payload in a single HTTP PUT. Maker's
request.text() intermittently failed before any Blob write on 512-KiB to
1-MiB compressed snapshots. Error: HTTP 503 snapshot_body_read_failed.

## New protocol (backwards compatible)

- Backup remains exactly qwerty-backup-v4, still carries all six Dexie tables,
  daily sessions, settings and navigation. Small snapshots retain original
  PUT /api/sync/v2 and explicit recovery PUT.
- Larger Base64 gzip uses immutable, account-scoped, content-addressed parts:
  POST /api/sync/v2/parts, at most 32 KiB Base64 each, 192 parts total.
- Every part includes SHA256 of its literal Base64 data, index, count and
  full compressed-gzip SHA256. Server validates and performs Blob exact-key
  readback before returning a receipt. No revision is advanced.
- POST /api/sync/v2/commit sends only part hashes and original V4 metadata.
  Server retrieves exact keys (no Blob list), checks part SHA, count, full
  gzip SHA and size; then calls the UNMODIFIED putSyncV4 validator for account
  ownership, V4 six-table integrity, logical fingerprint, version and
  revision conflict logic.
- Explicit recovery uses POST /api/sync/v2/commit/recovery and invokes ONLY
  putSyncV4Recovery with existing pinned remote SHA and account confirmation.
  It cannot silently convert a normal write into replacement.
- A lost part ACK may safely resend identical bytes. An ambiguous COMMIT
  response must re-read cloud revision, SHA, logical fingerprint before any
  further write. Never auto-overwrite from unknown outcome.
- Successful commit best-effort deletes the staging subtree. Account deletion
  additionally cleans all unfinished staged parts. Unfinished upload orphan
  collection / bounded TTL remains a storage-hardening follow-up.

## Real etest acceptance

The updated branch E2E requires v4-http-multipart-v1 in /api/health AND a
matching deployed frontend SHA. Tests use disposable accounts only. After
normal V4 auth and CAS tests, it uploads random 256, 512, 1024, 1536, 2048,
2700 KiB source burdens as small HTTP parts, confirms each reported cloud
revision, compressed SHA and logical fingerprint, then GETs and compares
the whole V4 payload byte-for-byte. Finally deletes all test accounts.

No master or default independent multi-device pilot feature flags change.
HTTP multipart is separate from Memory Ledger, cross-device event completeness,
six-table event merge, M4 automated event synchronization and Backup V5.

## Safety

- A staged part must NEVER advance the published revision.
- Invalid/missing/wrong-account part => fail closed.
- No Blob listing can serve as a proof of uploaded part completeness.
- Old large PUT may still fail in older clients; updated frontend sends parts.
- Must pass main Cloud Gate, published Pages gate, and real etest Maker gate
  on exactly the same promoted SHA before considering release.

## Etest first live attempt

The first etest deployment (7c27c935) passed the V4 auth/CAS setup but
its first 96-KiB POST part received an HTTP 500 before any new revision.
The stage unit was reduced to 32 KiB and unknown body-read exceptions
are now mapped to a retryable, unambiguous 503 with explicit code.

## P0 stage-level performance diagnostics (2026-10-14)

The production-safe upload protocol and all 90-second browser API, 20-second
live-gate HTTP, six-attempt **immutable-part-only** retry budgets are unchanged.
Changing a timeout without an observed stage-level bottleneck is prohibited.

A real 2026-10-14 etest run at df92fe40 passed the 256, 512, 1024, 1536
and 2048 KiB synthetic burdens and timed out during the 2700 KiB case.
The earlier runner logged only whole-upload outcome, so that failure alone
does not prove that the network or Blob was slow.

The new measurement chain:
- Browser: each **part index + attempt** retains elapsed HTTP time,
  response status, fixed success/failure code, staging phase and any
  server-reported Blob write/readback times. Aborted requests are marked
  `network_timeout` (client observation, **not** proof of network root cause);
  transport errors are `network_failure`. Server-side Blob stage failures
  are `blob_storage`. Receipt mismatch remains fail-closed.
- Maker POST /parts: separately measures `blobWriteMs`,
  `blobReadbackMs`, and `serverTotalMs`. 503 returns a fixed
  `failureStage` and sanitized timings in `details`.
- Maker POST /commit: separates staged `partsReadMs`,
  `commitCoreMs`, best-effort `cleanupMs`, and `serverTotalMs`.
  Inside the core, `revisionWriteMs`, `revisionReadbackMs`,
  `revisionManifestMs` and `revisionChunkCount` quantify the
  *second* immutable Blob persistence pass. Failed final commit is never
  blindly retried; remote metadata must be reconciled first.
- UI: the local performance report exports a bounded, redacted JSON
  stage trace. No account names, tokens, keys, URLs, payload bytes or
  learner content are kept. The actual real-EdgeOne stress runner emits
  structured part attempts and a per-upload stage summary.

### Next diagnostic gate

Run Cloud Sync Gate and branch-matched etest Maker tests on **the same
promoted SHA**. For the failure-inducing 2700 KiB burden, locate the
slowest part and calculate: part HTTP time vs Maker Blob write/readback;
commit parts-read vs core; within core revision writes/readback/manifest.
Test all 256-2700 KiB burdens and byte-exact GET afterward.

Only after capturing that evidence should the hot path be changed:
- slow HTTP with low server time => investigate Maker ingress/POP,
  upload request count, and bounded in-flight transport;
- slow staged Blob => evaluate storage write retries, explicit readback
  and bounded concurrency on distinct immutable keys;
- slow commit core/revision Blob => evaluate re-persistence cost,
  revision write scheduling and manifest durability, **without** dropping
  integrity checks or adding non-atomic CAS assumptions.

A release gate must not be cleared by simply raising test or fetch timeouts,
skipping the 2700 KiB case, allowing a partial V4 revision, or treating
ambiguous final responses as safe to replay.
