---
protocol_version: "1.1"
task_id: "TASK-20261010-012-s2-unified-manual-sync"
task_file: "interactive/tasks/TASK-20261010-012-s2-unified-manual-sync.md"
report_file: "interactive/reports/TASK-20261010-012-s2-unified-manual-sync-report.md"
target_branch: "product/main"
status: "ACTIVE"
executor: "ChatGPT (direct executor)"
claim_base_commit: "a319dc871a056c3b09c1988685b863af2358205b"
release_to_master: false
priority: "P0"
---

# S2 — Unified manual Sync (after S1 technical verification)

## Product objective

Replace normal Upload/Download buttons with ONE Sync action. The action
compares the account-scoped local Backup V4 logical fingerprint, current cloud
logicalFingerprint, and immutable account-scoped baseline revision before
choosing No-op / CAS Push / verified Pull / explicit Conflict.

## Strict boundaries

- S1 production opt-in V1→V4 migration and legacy-tab rollout acceptance remain
  blocked independently; **do not infer S1 production complete** from S2 dev.
- Develop on `product/main`; never update Maker-bound `master` without
  explicit release approval. Do not activate S2 cloud writes with V1 backend.
- Anonymous workspace must be local-only; account ID is immutable, not username.
- No auto merges/overwrites; no snapshot transfer on no-op; failures fail closed.
- Manual Sync can use the latest durable logical-word checkpoint mid-Block.
- Preserve S1 single-writer boot, crash journal, and original V1 path until
  user-visible V2 deployment gates are verified. No unrelated Typing changes.

## Development increments

- [x] S2-P0: extract pure deterministic V4 Sync decision kernel in
  `src/sync/v2-policy.ts`; run unit contract tests via `yarn test:cloud`.
- [x] S2-P1a: backward-compatible metadata handshake; expose transport
  `payloadSha256`, deliberately advertise `logicalFingerprint: null` for
  unverified V1/V3 snapshot revisions, and keep V4 writes disabled.
- [x] S2-P1b: versioned server V4 metadata (`logicalFingerprint`,
  `payloadSha256`, revision) with canonical fingerprint verification,
  explicit V1→V4 compatibility/migration policy and optimistic CAS, tested
  under concurrent devices. The V2 backend endpoint is implemented behind
  an unexposed UI; no Maker deployment. Legacy V3-to-V4 migration remains
  an explicitly blocked case, not an implicit overwrite.
- [ ] S2-P2: account-scoped baseline persisted outside portable workspace;
  guarded V4 snapshot executor (quiescent copy, hash/identity validation,
  safe pull journal + restart), fault injection and crash replay.
- [ ] S2-P3: one normal Sync button, directional actions only in advanced
  recovery, visible network/account switch status, no-op instrumentation.
- [ ] S2-P4: simulated 2-device/3-device interleavings, real EdgeOne
  disposable-account tests, live Maker release gate and S1 production migration
  prerequisite acceptance.

## Acceptance for P0

Contract covers noop, safe push/pull, conflict, unbound new-device cases,
auth identity mismatch, missing/legacy metadata, revision regression,
inconsistent cloud hash, unknown baseline and side-effect freedom. Build,
lint, Cloud Sync Gate PASS. A GREEN P0 does NOT mean cloud V2 is live.
