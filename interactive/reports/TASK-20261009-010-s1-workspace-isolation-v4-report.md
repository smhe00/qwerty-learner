---
protocol_version: "1.1"
task_id: "TASK-20261009-010-s1-workspace-isolation-v4"
status: "PARTIAL"
executor: "ChatGPT (direct executor)"
target_branch: "product/main"
claim_base_commit: "77ce352abdf15148da69ed90b47fc77f03fd5039"
last_verified_source_commit: "c9d6dfa001e68d8e25c1f581ec2b6f1e99fd2007"
release_to_master: false
dirty_worktree: false
---

# S1 Workspace Isolation: implementation and verification checkpoint

## Summary

Partial delivery: developed a standalone executable Backup V4 model, an
opt-in browser V4 capture/restore adapter, an independent durable per-account
IndexedDB vault, a CAS-backed registry, a guarded IO coordinator, and an
exclusive writer lease. **None are wired to production V1 account UI.**
No master push, EdgeOne build, account deletion or live-user migration.

## Implemented source

- `src/sync/workspace-v4.ts`: V4 workspace envelope with complete logical
  database, allowlisted WorkspaceSettingsV1, durable DailySession state,
  navigation, source account ID (not username), strict decode and
  metadata-independent deterministic logical fingerprint.
- `src/sync/workspace-v4-browser.ts`: V3->V4 capture of real Dexie records,
  FSRS/achievement/review records, durable daily state, settings, and
  idempotent V4 restore/empty reset. Requires external writer exclusion.
- `src/sync/workspace-vault.ts`: separate IndexedDB snapshot vault,
  immutable accountId keys, atomic registry generation CAS, checksum
  integrity check and corruption rejection.
- `src/sync/workspace-coordinator.ts`: explicit legacy workspace ownership
  initialization and guarded source save/target restore/recovery.
- `src/sync/workspace-lock.ts`: Web Locks single-tab writing lease,
  intentionally not yet wired into app startup.
- `src/sync/workspace-transition.ts`: existing journal/CAS/Crash kernel;
  unchanged from baseline `8f7b6188`.
- Added isolated local Chromium workflow
  `.github/workflows/s1-workspace-gate.yml` and browser fixtures.

## Verification actually completed

| Check | Actual result | Evidence |
| --- | --- | --- |
| Cloud backend + S1 domain tests | PASS 35/35 | Cloud Sync Gate 37855817254 |
| ESLint cloud and sync source | PASS | same run |
| Vite production bundle | PASS (17.01s) | same run |
| Chromium V4/IDB/Crash/isolated workspaces/tab locks | PASS 6/6 | S1 Browser Gate 37856059765 |
| Verification Contract Gate on formal baseline | PASS | 37854631854 |
| Previous Learn/Review Gate | PASS | 37854631871 |
| Full S1 account UI E2E | NOT_RUN | no UI integration |
| S1 early-boot writer fencing | NOT_RUN | not implemented |
| S0.5 mandatory Sync TLA Gate on mutation changes | IN_PROGRESS / NOT VERIFIED | run 37856150599 |
| Three-device/four-username TLC full exhaustion | NOT_PROVED | manual nonblocking exploration |

The first formal run 37854631911 failed specifically because the stale-push
negative control could not reach a counterexample with its previous
projection/bounds. Its mutation-only config was updated to
`MaxSettingVersion=1`, `NEXT NextBlock` so the local setting transition
actually participates. The canonical `Next` and `Safety` were not changed.
The new TLA outcome must be inspected before claiming success.

## Data safety and rollout

Production Cloud Sync V1 still writes qwerty-backup-v3; no automatic V4
migration or account binding is enabled. `RecordDB` is still a singleton
working DB in the existing UI. The isolated S1 adapter operates only when
explicitly invoked under an exclusive lease and no other working writers.

## Remaining acceptance gaps / next action

1. Early app bootstrap + tab-wide ownership gate and recovery-before-hydration.
2. Migrate V1 local/auth ownership only with an explicit one-time user
   decision, including unowned/anonymous and dirty account data.
3. Make login/logout/register/reauth pathways use observable transaction
   stages, progress, failure and rollback; A->B requires anonymous stage.
4. Multi-tab broadcast/rebind and stale-writer inhibition across all existing
   database writers, not only the new coordinator.
5. Expand Playwright scenarios for offline/auth-expired/conflict/Crash at
   every operation boundary; check traces against canonical TLA+.
6. Review and close S0.5 negative-control CI outcome separately.

The next executor should begin from product/main at or after `c9d6dfa0`,
check `interactive/CURRENT_TASK.md`, the task and this report, and
continue without touching `master`. No claim that S1 is ready to release.
