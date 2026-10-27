# Resumable history verification — development only
Status: COMPLETE; validated for development integration. Base: 6427b669. Executor: Codex-history-resume.

## Behavior
The incident snapshot on production 15fffa2 showed successful V4 upload/noop followed by witness-server-unverified. No incident account, credentials or learning payload has been copied into this repository. The original server reason was not present in that incident; this change does not claim a proven underlying Blob incident fix.

The existing authenticated verify-set route accepts opt-in segmented verification. Each call validates at most 8 previously unverified immutable batches; each boot advances at most 2 pages. Server-owned content-addressed checkpoints bind authenticated account and exact selected heads. Append-only head extensions reuse old evidence only after exact predecessor/fork validation; rollback/replacement/account/generation mismatch cannot reuse it. Four-device/128-per-device discovery stays unchanged; aggregate verification is bounded at 512 receipts rather than failing at 128 across devices.

Checkpoint state retains receipt identities and SHA256 hashes of canonical immutable attempts, never tokens or raw learning words. The versioned attempt-sha256-v1 final set digest is recomputed independently by the browser; legacy nonsegmented canonical digest remains supported. Duplicate UUIDs, contradictory immutable events, forks, gaps, account ownership and all existing projection guards remain strict. Partial results have no remoteEvents or merge authorization. Only complete verified results reach unchanged M4 scratch capture, full V4 integrity audit, undo journal and guarded adoption.

Server cache uses bounded 160 KiB JSON-string chunks under the existing account-deletion checkout prefix (_history), separated from event discovery and checkout declarations; SHA-checked manifest/readback is required. Account deletion removes these chunks. Content addressing reuses identical checkpoints. This is additional server cache storage (not a new authoritative history). Account lifetime/history changes retain old cache objects until existing account cleanup; no retention sweeper is introduced here. Verification is classified as a barrier writer because checkpoint writes must drain even with activity tracking disabled. No authoritative ambiguous write retry behavior changed.

Browser IDB cache stores one account-scoped continuation, generation/head binding and exact downloaded immutable batches. Cursor is not authority: server reauthenticates and checks its own content-addressed state on every visit; cached rows still need the final independent full digest and immutable identity checks. Downloads advance by at most16 new batches per visit and survive reload. Unavailable/corrupt evidence blocks adoption. No working learning table is modified by continuation.

UI distinguishes complete snapshot sync from pending history verification/reading, including completed/total batches. A verified completion removes only stale history-phase notices. Safe diagnostic codes identify gaps, verification budget, checkpoint missing/corrupt/unconfirmed, session changes, transport failure, forks and conflicting attempts; bounded counters only, no raw exception/token/account/cursor leakage. A partial idle reconcile does not repeatedly interrupt learning.

## Validation
- Final integrated focused cloud/source contracts:157/157 PASS.
- Browser:4/4 PASS (Chrome desktop and mobile viewport) for durable page/download continuation, account/generation reset, final digest and tampering.
- Existing startup/passive-account browser regression:10/10 PASS, including real pending recovery journals, budget expiry, offline, lost upload response without duplicate POST, and reauthentication.
- Large synthetic checkpoint:2048 events across64 batches; chunked server cache and independent digest PASS. More than128 combined receipts across two devices completes with bounded calls. Appended learning reuses completed pages; forks and contradictory UUIDs block.
- Scoped ESLint:0 errors,13 existing warnings in touched legacy code. New browser test files pass with the TypeScript parser (repository default lint parser does not cover tests/e2e).
- Full tsc:143 existing diagnostics outside changed files; changed source has zero diagnostics. Four old map-iteration diagnostics in touched receiver were eliminated via Array.from. Not a globally clean typecheck.
- Final integrated Pages-mode Vite build PASS (26.35s). Bundle-size warnings remain.
- No real cloud account operations, staging deployment, production deployment or physical-device acceptance.

## Resume/integration
Independent branch codex/history-resume-20261027. CURRENT_TASK belongs to Circle latency and was preserved. Implementation2c714864; normal integration with origin/product/main b2336d25 completed in e86f1572 without conflicts. Final checks passed; only product/main is the push target. Do not push master/edgeone-test. Local test logs remain ignored under test-results/.

No staging/production claims: real EdgeOne Blob latency, lifetime cache-storage cost and physical devices were not measured. The real incident must be checked after a separately authorized release; its old package lacked the server-specific reason. Existing per-device128 and device-count4 bounds remain; pagination does not promise unbounded history discovery.
