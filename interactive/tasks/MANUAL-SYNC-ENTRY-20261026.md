---
task_id: MANUAL-SYNC-ENTRY-20261026
status: IN_PROGRESS
executor: ChatGPT (independent scoped UI work)
base_commit: 9457db9572e9561cffb717a7f8d1fb733ba12b65
target_branch: feat/manual-sync-entry-20261026
report_file: interactive/reports/MANUAL-SYNC-ENTRY-20261026.md
release_to_master: false
---

# PC account dropdown and mobile one-tap guarded manual sync

User explicitly selected PC signed-in account hover/click dropdown containing
one-click Sync and Account Management. Mobile should retain direct one-tap Sync
access on home and learning header. Both reuse the existing /?s2-sync=run
pre-mount guarded transaction; NEVER call executeManualSyncV2 in mounted React.

Requirements:
- Account dropdown opens on hover with slight dwell and stays open across
  pointer travel; click/touch and Escape/outside close supported.
- Account Management remains behind explicit menu click; anonymous login
  entry unchanged. Do not interfere with keyboard typing on mere hover.
- Mobile icon controls >=44px; no added menu layer in study.
- Save pending Learn persistence before navigation; if it fails do not leave.
- Full-document replace, guarded writer lease, CAS/automatic merge unchanged.
- Return to the same learning route, paused after Sync, without replaying word.
- Only a verified S2 noop/push OR fully recovered Pull may display success.
  Unknown/failure retains local records and reports accurately, no success pop.
- No unrelated changes to M3/M4, session handoff, transport or master.
- Existing independent IDLE-ACCOUNT-ACTIVATION CURRENT_TASK must not be changed.
- Validation: compile/build, scoped contracts and a realistic UI smoke.
- Feature branch first; preserve newer main changes and report final commit.
