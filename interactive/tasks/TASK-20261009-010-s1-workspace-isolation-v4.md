---
protocol_version: "1.1"
task_id: "TASK-20261009-010-s1-workspace-isolation-v4"
status: "PARTIAL"
executor: "ChatGPT (direct executor)"
target_branch: "product/main"
release_to_master: false
priority: "P0"
depends_on: "S1 foundation commit 8f7b6188"
---

# S1 Workspace Isolation — Backup V4, vault, multi-tab fencing and activation

## Objective

Implement S1 local anonymous/account workspace isolation to the canonical
`docs/CLOUD_SYNC_V2_MODEL.md` and `formal/sync/CloudSyncV2.tla`.
Preserve ALL existing V1 user data. S0.5 is conditionally frozen; 3x4 TLC
is an optional exploratory workflow and must not be misreported as proven.

## Baseline already committed

- `8f7b6188`: mandatory bounded formal gates retained, expensive 3x4 model
  moved to manual action, S1 transactional coordinator and 9 tests added.
- `src/sync/workspace-transition.ts` is **NOT YET WIRED** to UI or V1 DB.
- `docs/S1_WORKSPACE_ISOLATION_IMPLEMENTATION.md` contains the audited
  prerequisites and exact transaction ordering.
- Current source still exports Backup V3 and uses the singleton RecordDB.
  Do not label S0 or S1 complete until all acceptance gates are met.

## Scope / ordered work

### P0 — canonical Backup V4 prerequisite
1. Define `WorkspaceSnapshotV4`: complete durable IndexedDB tables,
   durable Learn DailySession/runtime state, explicit WorkspaceSettingsV1
   whitelist, navigation, and metadata; exclude tokens/baselines/device IDs.
2. Implement deterministic canonical logicalFingerprint independent of
   compression/envelope transport metadata.
3. Implement V3 -> V4 one-way migration; V3 stays readable for migration,
   V4 is written for Sync V2 only after migration. Do not silently change
   V1 remote protocol or reinterpret old hashes.
4. Migration and round-trip tests with data having unfinished Learn blocks,
   daily sessions, FSRS records, achievements, and nondefault preferences.

### P1 — isolated durable workspace vault
1. Persist full workspace snapshots under immutable accountId (not username);
   separate anonymous workspace, plus working DB.
2. Implement `RegistryPort` with atomic, durable generation CAS in IndexedDB
   or equivalent, not localStorage read-then-write.
3. Implement `ReplicaPort` with flush->save->restore. Missing target must
   become clean empty workspace; restore must be idempotent.
4. Recovery on app startup before mounting React/DB writers; pending journal
   must block all writes until recovered or report fatal recovery error.
5. Add crash injection at every phase, reload, two switches, offline, failed
   storage operations and snapshot corruption; NEVER silently discard data.

### P2 — multi-tab writer fencing
1. Exclusive lock across same-profile tabs; quiesce all in-flight DB writes
   and stop stale tabs from writing the old workspace.
2. Broadcast/rebind or require reload after generation change.
3. Exercise interleaved tabs and stale-generation CAS collision with actual
   IndexedDB/browser tests (not only mocked ports).

### P3 — account/UI activation
1. Explicit account switch A->anonymous->B with visible progress/failure,
   logout dirty data preservation even if cloud is offline.
2. Registration only from anonymous, explicit one-time copy decision; never
   merge account A/B/anonymous implicitly.
3. Distinguish voluntary logout from auth expiry/revoked session.
4. Do not enable switching until P0-P2 invariants pass and V1 migration path
   has tested rollback/recovery.

## Out of scope

- Sync V2 S2 unified manual Sync, S3 Block auto-sync, S4 destructive full
  deletion; no silent replacement of production V1 behavior.
- Changing Learn/Typing algorithms, FSRS parameterization or release branch.
- Reworking S0.5 into a new protocol merely to make TLC fast.
- Triggering EdgeOne Maker or modifying `master` without explicit approval.

## Acceptance criteria

- Account A's DB/settings/unsynced checkpoint never appear in B or anonymous.
- Crash at every journal/restore boundary resolves deterministically on reload.
- No stale tab can write the previous workspace after switch.
- Registration/accountId identity is never keyed by mutable username.
- V3 records migrate once; Backup V4 restores complete durable logical-word
  progress and settings (including under crash/retry) without data loss.
- S1 UI shows in-progress, success, explicit failure and which account remains
  active; rollback path preserves all sources.
- Contract trace tests map switch transitions to canonical TLA+ events.
- Old V1 paths remain unchanged until the new capability's gates pass.

## Required validation

- `yarn test:cloud`; `yarn eslint src/sync src/utils/backup.ts --ext .ts,.tsx`;
  `yarn build`; `node scripts/validate-gate-manifest.mjs`.
- Real-browser Playwright tests: two tabs, restart/crash, anonymous->A->logout
  ->B, offline/reauth, stale tab, migration and account data isolation.
- Mandatory bounded TLA Gate; the manual 3x4 action is nonblocking.
- Commit in reviewable checkpoints and report PASS/FAIL/NOT_RUN truthfully.

## Deliverables / Git permissions

Source/tests/docs; `interactive/reports/TASK-20261009-010-s1-workspace-isolation-v4-report.md`.
Normal fast-forward commits to `product/main` permitted. Do not push
`master`, do not publish, do not alter production or delete real user data.
