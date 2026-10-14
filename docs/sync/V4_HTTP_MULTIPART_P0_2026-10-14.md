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
