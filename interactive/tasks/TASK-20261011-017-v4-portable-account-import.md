---
protocol_version: "1.1"
task_id: "TASK-20261011-017-v4-portable-account-import"
task_file: "interactive/tasks/TASK-20261011-017-v4-portable-account-import.md"
report_file: "interactive/reports/TASK-20261011-017-v4-portable-account-import-report.md"
target_branch: "product/main"
status: "IN_PROGRESS"
executor: "ChatGPT (direct executor)"
release_to_master: false
priority: "P0"
---

# P0 — Formal Backup V4 local restore, including cross-userId recovery

## Product goal

A V4 file must be **portable learning data**. The file's old immutable
userId identifies the origin; it must never prevent a legitimate owner of
the file from starting a NEW account after losing the old password. This is
learning-data recovery, **NOT** access to the old account/cloud/token.

Use the existing normal Data Settings "本地备份" section; no test-only
temporary UI and no raw JSON edits.

## Required behavior

- [ ] Same-account, cross-account and anonymous→account V4 full local import
  supported. Cross-ID case prominently displays source and target immutable
  IDs and a **complete replacement** warning. Default is cancel.
- [ ] Preview six-table counts, FSRS/Review records, daily sessions, settings,
  navigation and format validity; validate typed **current account ID** plus
  two separate confirmations. Never auto-merge, never copy the old token or
  old cloud account ID/baseline.
- [ ] After login/registration only the currently active S1 owner may receive
  the rebased workspace. Never activate source userId; don't overwrite
  account A from a different signed-in user's tab.
- [ ] Trigger **download of full CURRENT local V4** before replacement;
  preserve an immutable restorable pre-import snapshot in S1 Vault even if
  file download fails or user closes the tab.
- [ ] Stage imported *verified* V4 snapshot into durable independent journal
  while the current isolated workspace is active, with owner, S1 generation,
  SHA/fingerprint and original provenance. Do not restore while React/IDB
  writers are mounted. Re-validate on guarded pre-mount entry under
  exclusive Web Lock; reconcile interrupted DB/settings restore BEFORE mount.
- [ ] Full six-table Dexie restore, daily sessions, settings and navigation;
  post-restore recompute fingerprint/counts and reject missing/mutated
  learning fields, account identity or journal revision.
- [ ] Invalidate **current target account's** S2 sync baseline atomically
  with import-journal completion. Mark imported local state as requiring
  explicit cloud reconciliation. NEVER auto-pull or auto-push after replacing
  current workspace; pre-existing cloud data may be different.
- [ ] Original V4 gzip byte-for-byte untouched. Rebinding changes only V4
  envelope ownership (and optional metadata createdAt) of the copied
  candidate, not any learning-history row. Source account's cloud/Vault
  are untouched.
- [ ] Work with current-account expired token: offline local recovery still
  possible if S1 owner was previously authenticated, but cloud upload
  requires a new valid session; never grant login by possession of backup.
- [ ] Once import succeeds, show result as **本地恢复完成，云端未覆盖**.
  Let user explicitly choose cloud policy after inspecting remote revision.

## Core tests (blocking)

- [ ] Pure rebinding tests prove learning payload/fingerprint unchanged,
  source preserved, account mismatch requires consent, wrong IDs refused.
- [ ] Chromium actual Dexie six-table 500+ record import, FSRS shadow/
  typingTelemetry, DailySession and settings equality after reload.
- [ ] Crash injection before stage, after stage, during IndexedDB restore,
  during settings restore, after journal commit, after baseline reset.
- [ ] Two independent tabs, owner switch and deliberate malformed/import
  mixed-userId tests; legacy V1 must fail closed or migrate through S1 first.
- [ ] Cloud CAS conflict guard: existing V4 account cloud is never silently
  overwritten/pulled during the first Sync after manual import.
- [ ] Real Maker disposable test account after CI. Delete only disposable
  test accounts, never edit actual user's cloud.

## Architecture constraint

Existing `restoreWorkingWorkspaceV4()` rejects owner mismatch and is only
safe pre-mount. `syncV2PullJournalPort` is NOT a suitable shortcut because
it binds to a remote Revision and cloud fingerprint. Build a separate
`manual-v4-import-journal` with explicit import provenance, durable
source vault rollback witness and atomic target baseline invalidation.

The pure plan/rebinding module may be merged earlier, but no destructive UI
button is released until every mandatory Gate above passes.
