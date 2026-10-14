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
- Browser uploads of larger snapshots use **192 KiB raw gzip binary**
  per POST /api/sync/v2/parts (`Content-Type: application/octet-stream`),
  up to 192 requests. The single-body small-snapshot V4 PUT remains legacy
  JSON/Base64 to avoid extra round trips. Base64 is no longer on the *multipart
  HTTP request body*; the canonical Backup V4 format is unchanged.
- The binary POST carries only bounded metadata headers:
  `X-Qwerty-Payload-Sha256`, `X-Qwerty-Part-Sha256`,
  `X-Qwerty-Part-Index`, `X-Qwerty-Part-Count`.
  All indices, bounds, raw-byte SHA-256 and receipts are strictly validated.
- Maker's Blob JSON adapter does **not** assume the SDK supports binary
  objects. It splits the internal Base64 representation of each 192-KiB
  binary upload into up to two immutable **128 KiB Base64** Blob JSON
  records. This avoids oversized Blob writes and provides exact-key
  readback and per-part checksums. Staging has format version 2; old
  version-1 Base64/32-KiB stage records remain readable for open tabs.
  Mixed versions in a single manifest fail closed. No revision is advanced.
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

The updated branch E2E requires v4-http-binary-192k-v1 in /api/health AND a
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

## 192-KiB raw transport update (development branch only)

The previous 32-KiB HTTP/Base64 setting was a conservative workaround, **not**
a proven EdgeOne maximum. On live etest at commit 85c9cbb2, 2048 KiB required
86 HTTP calls, with 107.7 seconds cumulative HTTP time but only 8 seconds
server-side staging time. Some 32-KiB requests still returned retryable 503
v4_upload_body_read_failed. This justified testing a larger raw-body request
without increasing the existing 20s/test and 90s/browser request timeouts.

The same etest revision passed upload and final commit for 2048 KiB but
failed its full GET despite HTTP 200 (not enough evidence of Blob corruption).
The updated smoke test preserves only the redacted response byte count,
declared Content-Length, parse-failure category and metadata. Full-response
download is **still JSON/Base64**, not binary; a future independently gated
download transport is needed to remove Base64 from all network traffic.

**Deployment discipline:** commit and CI on product/main; advance
edgeone-test only after passing Cloud Gate and release-admission checks.
Require both deployed frontend SHA and binary Maker capability before any
real disposable-account stress. Do not update production master from this
work. Do not claim reliability of 192-KiB Maker raw-body reads before real
EdgeOne verification, or waive byte-exact 2048/2700 KiB GET checks.

## Native binary Sync V4 architecture and one-click migration (2026-10-14)

**New write/read path (product/main only, not GA):**
- Local V4 workspace snapshot: canonical six-table JSON => `pako.gzip` =>
  `Uint8Array`; calculate SHA-256 on raw gzip bytes. Do NOT allocate a
  Base64 string in the guarded S2 manual Sync executor.
- HTTP POST /sync/v2/parts: bounded 192-KiB `application/octet-stream`,
  immutable payload/part SHA-256 and exact part index/count in headers.
- Maker stages raw immutable byte objects via EdgeOne `store.set(ArrayBuffer)`
  and verifies via `store.get(type: 'arrayBuffer', consistency:'strong')`.
  V3 staging keys embed payload SHA + part count + index + part SHA.
- Commit reconstructs Buffer, verifies gzip SHA and **complete canonical
  Backup V4 six-table content**. Server storage creates native 192-KiB
  immutable Blob revision chunks and only then creates its JSON metadata
  manifest (v2 binary layout). Metadata is small; payload is binary.
  The old Base64-backed revision layout remains read-only compatible.
- GET /sync/v2/binary/manifest returns revision, full gzip SHA, logical
  fingerprint, length, exact chunk count and per-part SHA values.
  GET /sync/v2/binary/part pins each request to **revision + full SHA +
  part index**, refuses stale revisions, serves binary bytes, and verifies
  each SHA before HTTP 200. The browser checks all per-part SHAs,
  total byte length and full SHA before bounded inflation and V4 validation.

**One user action, recoverable steps (NOT atomic across devices):**
1. Pre-mount S1 writer lease and authenticated owner/workspace witness.
2. Read remote metadata. If old format, send exact pinned
   `baseRevision + payloadSha256 + logicalFingerprint` to
   POST /sync/v2/binary/migrate. Server reads and verifies the old full
   snapshot, then creates a NEW native binary V4 revision using the same
   logical and gzip digests. It does not overwrite the old revision in place.
3. On ambiguous migrate response, re-read remote metadata. Continue
   only if new binary revision has EXACT original logical/SHA evidence
   and expected revision increment. Otherwise fail closed. A repeated
   migration request for a revision already binary is an idempotent no-op.
4. The normal S2 preflight then decides noop/push/pull against the new
   binary revision. Pull restores only through the existing durable
   pre-mount journal. Push uses existing CAS and full V4 validation.
5. The local Dexie learning records and original local workspace JSON never
   contained Base64 in the first place. Only the former S2 *transient
   snapshot transport* used Base64; this is now raw gzip bytes.
6. Do not remove legacy Blob storage or manually clear local data.
   Old snapshots/revisions remain available under existing retention policy.
   Historical V1/V3 and backup import compatibility is separate and
   remains read-only/explicitly guarded; **new S2 Sync** uses zero Base64.

No change to Backup V4 logical format, FSRS memory logic, multi-device
safety contract, explicit recovery evidence, original request timeout,
or max compressed/inflated bytes. No claim of true Blob atomic CAS.
Deployment requires exact-SHA main Cloud Gate and Pages gate, then
staged etest native Blob read/write verification, migration replay,
large (up to 2700 KiB) byte-exact download, and app regression tests.
Never promote to master merely because unit tests pass.
