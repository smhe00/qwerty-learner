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

# Current task — S2 unified manual cloud Sync

S1 technical acceptance: 46/46 Chromium, Cloud Sync Gate, Review Gate,
and mandatory bounded TLA Gate PASS. However S1 production V1→V4
migration, legacy tab rollout/repair and Maker live verification remain
`PARTIAL / RELEASE BLOCKED` as audited in
`docs/S1_CLOSEOUT_AUDIT_20261010.md`.

User instruction: start subsequent development on `product/main` with
no automatic release to `master`.

Active: S2-P0 pure deterministic V4 decision kernel and tests.
Next: S2-P1 backend V4 metadata/CAS after current CI validation.
Detailed task and report files above. Previous S1 task and reports are
retained unchanged as history.

2026-10-10 S2-P0/P1a checkpoint: source `a18b110e` passed Cloud Sync Gate
38045048350 (62/62 tests, lint/build). Source `97fcaf220` passed Cloud
Sync Gate 38045228572 for the server's conservative V4 metadata handshake.
Next implement P1b server-verified V4 upload semantics; do not enable any S2
write/restore/UI feature before authorization and live-server verification.

2026-10-10 S2 P1b/P2 milestone: backend V4 verified upload/CAS and
immutable-owner validation shipped to `product/main` only. New dev
`/api/sync/v2` endpoint is NOT deployed to Maker. Validated source
`121ffb38` Cloud Sync Gate 38045787565 PASS.

The pure client decision kernel, durable account-scoped baseline CAS,
read-only preflight and bounded verified V4 download are implemented
without activating production Push, Pull, Sync button or migration.
Latest source `b761a4ef` Cloud Sync Gate 38046454667 PASS (Node
contracts, frontend lint, Vite build). Real S1 browser gate for the
baseline harness `fa068ecc` 38046423639 PASS **48/48**; the two new
baseline tests prove persistence across reload and cross-tab CAS
rejection. Review Gate on `fa068ecc` is independently tracked in
run 38046423650 and must not be called PASS before conclusion.

CURRENT P0: S2-P2b crash-journaled pull executor, writer-quiesced
pre-mount operation, failure/rollback/reload replay; gate must include
mid-restore crash, stale cloud revision, expired credentials and
simultaneous tabs. Preserve original S1 production rollout blocker
and never release master automatically.

2026-10-10 S2-P2/P3a/P4a dev acceptance checkpoint:
- Server V4 integrity and complete six-table manifest required before
  destructive restoration, both browser and backend.
- Pre-mount writer-locked Sync executor, CAS Push, zero-payload No-op,
  verified/rechecked Pull, local source vault copy, staged recovery journal,
  IDB baseline atomic commit are implemented.
- Single Sync pilot route `/?s2-sync=run` is accessible ONLY under
  Vite DEV or explicit `VITE_S2_ENABLE_UNIFIED_SYNC=true`; default
  production flag OFF. No normal upload/download controls in isolated mode.
- Source `b16673cd`: real Chromium S1 Browser Gate
  [38048589692](https://github.com/smhe00/qwerty-learner/actions/runs/38048589692)
  **PASS 53/53**; includes guarded full navigation route and post-sync
  feedback plus crash replay, corrupt journal and expired auth.
- Source `88a56fd`: Cloud Sync Gate
  [38048701997](https://github.com/smhe00/qwerty-learner/actions/runs/38048701997)
  **PASS 95/95** Node contracts, frontend/backend lint and Vite build.
  Includes three-device simultaneous CAS/winner test.
- Learn Journey [38048383193](https://github.com/smhe00/qwerty-learner/actions/runs/38048383193)
  PASS; Achievement [38048383202](https://github.com/smhe00/qwerty-learner/actions/runs/38048383202)
  PASS. Review run 38048383109 must be checked separately; at this
  checkpoint it has not yet been accepted as completed.
- No `master` sync or EdgeOne Maker build authorized. Live V3 cloud data
  remains blocked from V4 overwrite without explicit migration consent.

NEXT P0: S2-P3b conflict recovery/migration UX; S2-P4b disposable-account
EdgeOne live V4 verification and S1 production consent/rollback SOP.
The user should not enable the production V2 flag before these gates.
