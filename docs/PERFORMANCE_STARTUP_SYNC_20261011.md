# Qwerty Plus — Startup / S2 Sync performance (2026-10-11)

## Scope and release boundary

- Feature branch: `feature/perf-boot-sync-p0-p1-20261011` targeting `product/main`.
- **Do not advance `master` or trigger an EdgeOne Maker build for performance instrumentation.**
- Preserve S1 single-writer Web Lock, recovery journals, immutable workspace identity,
  V4 six-table export audit, browser/server canonical fingerprints, revision CAS
  and no-silent-overwrite rules.

## Code-level findings

1. A manual no-op Sync still captures/exports the entire Dexie DB, reads all six
   source tables, verifies row payloads, canonicalizes and hashes the V4 snapshot.
2. Canonical sorting previously recursively serialized each compared row multiple
   times during O(N log N) sorting. Precomputed sort keys lower serialized work
   without changing the old comparator or fingerprints. Browser and server must
   match on the **identical canonical string**.
3. Full-page navigation into `/?s2-sync=run` and back to `/` reloads the app
   twice by design. Do **not** bypass the pre-mount owner lease to remove reloads.
4. Normal startup doesn't export a V4 snapshot; it obtains a Web Lock, checks
   vault registry and recovery journals, verifies the localStorage witness, then
   imports React and loads the selected dictionary JSON. Diagnose separately.
5. Cloud metadata fetch is read-only and can overlap local snapshot capture.
   S2 still relies on server CAS on Push and revision recheck before Pull staging.

## Implemented in feature branch

- Precompute canonical JSON sort keys on browser and server, preserving V4 digest.
- Overlap read-only cloud metadata preflight with snapshot capture.
- Session-only, bounded, privacy-safe startup/Sync timing metrics.
- Record UTF-8 uncompressed JSON and gzip payload bytes.
- Readable report at `/?perf-report=view` with local-only JSON export.
- Tests for historical/browser/server V4 fingerprint equality and diagnostics
  redaction/bounds/fail-open. Existing S2 tests must also pass.

## Timing stages

Startup:
`writer-lease`, `registry-read`, `journal-check`,
`auth-reconcile`, `guarded-bootstrap`, `app-module-import`,
`entry-to-first-frame`, `dictionary-fetch`, `dictionary-json-parse`.

Sync:
`sync-total`, `flush-writers`, `snapshot-capture`,
`dexie-export`, `source-rows-read`, `source-rows-audit`,
`fallback-roundtrip-audit`, `remote-meta`,
`fingerprint-decision`, `payload-prepare`,
`gzip-compression`, `payload-raw`, `payload-gzip`,
`upload-request`, `download-request`, `verify-downloaded`,
`remote-meta-recheck`, `save-prepull-vault`,
`stage-pull-journal`.

Because several stages are nested/overlapping, their durations must **not**
be summed as mutually exclusive wall-clock time. Network and CPU time need
separate presentation.

## Remaining P0: safely skip no-op full export (NOT IMPLEMENTED)

Do not infer no changes solely from prior SHA, last sync timestamp or
`localStorage` flags. A trustworthy fast path requires:

1. Audit **every** persistent writer (all six Dexie tables, relevant Learn
   sessions, settings and navigation), including legacy paths, migrations,
   tabs and crash/journal replay.
2. Create an atomic monotonic local change generation or equivalent evidence
   that updates transactionally with durable changes; track account identity
   and active Workspace generation.
3. Persist only a validated canonical V4 fingerprint tied to that generation
   and the full source/export audit. Invalidate on schema changes, failed
   writes, imports/restore, app update, ownership switch, or uncertainty.
4. No-op only after checking remote V4 metadata and the verified generation,
   fingerprint, account ID and revision; never treat an absent/old cache as
   proof of equality. If unsure, run the existing slow path.
5. Add tests with stale caches, background writers, failed transactions,
   write/revert, cross-account switch, concurrent cloud revisions, and crashes.
   Confirm no stale-data Push or false No-op is possible.

## Verification before merge

- `npm run test:cloud`
- `npm run build`
- Review TypeScript compilation (the Vite build transpiles TS but may not
  type-check; run `npx tsc --noEmit` or the existing type gate if practical).
- Regression: V4 old/new canonical fingerprint identical for fixed fixtures,
  browser/server parity, push CAS, verified Pull, S1 journal replay.
- Browser runs on both empty/new and substantial learned DB: collect startup,
  Sync-noop and Sync-push metrics. Record cold/warm cache separately.
- Do not claim a measured speedup until pre/post wall-clock samples exist.

## Privacy and limitations

The report contains only fixed stage names, elapsed milliseconds and aggregate
byte counts and stays in this browser tab's sessionStorage. It does not upload
telemetry or store user rows, auth tokens or account IDs. Metrics begin when
the JS entry executes and do not include initial HTML download; combine with
browser navigation timing for full cold-load TTI analysis.
