---
protocol_version: "1.1"
task_id: "TASK-20261011-016-s2-maker-ui-pilot"
task_file: "interactive/tasks/TASK-20261011-016-s2-maker-ui-pilot.md"
report_file: "interactive/reports/TASK-20261011-016-s2-maker-ui-pilot-report.md"
target_branch: "product/main"
status: "READY"
executor: "unassigned"
release_to_master: false
priority: "P0"
---

# S2 rollout Gate — Enable pilot UI for real Maker independent browser journey

## Scope

This is a **post-P4b general-availability Gate**. P4b protocol qualification is complete, but current production S2 front-end is intentionally disabled. Do not conflate previous independently successful real Maker API tests and simulated-cloud Chromium journeys.

- [ ] First complete `TASK-20261011-014-forced-session-revocation` (revoked-session user notice and safe anonymous ownership transition).
- [ ] Enable S2 UI only for a bounded pilot via an explicit frontend launch gate, with the server-side immutable accountId allowlist enforced independently.
- [ ] Use disposable Maker accounts in two/three isolated durable Chromium contexts: real UI Login -> S1 isolated workspace -> Learn V4 records -> V2 Push -> independently logged-in second browser Pull -> FSRS row/daily session equivalence.
- [ ] Verify B login invalidates A; old A sees forced-logout dialog; user confirms and A switches to anonymous with account Vault intact. No implicit data merge and no anonymous leak.
- [ ] Concurrent edits, failed network, torn acknowledgments, reload and recovery journal with real Maker/Blob; check cloud Revision, V4 transport SHA and logicalFingerprint.
- [ ] Explicit V3→V4 migration with both original gzip backups downloaded and confirmed, user-selected direction, immutable owner ID, then re-read on second browser.
- [ ] Abort and roll back pilot flag on any missing journal, wrong owner, lost rows or stale-write success. Preserve V4 legacy-write barrier and durable V4 data.
- [ ] Run CI regression and record exact deployed SHA, Maker build version, data counts, status and account deletion evidence. No public rollout on incomplete Gate.

## Additional dependencies

Investigate `TASK-20261011-015-maker-intermittent-500`; do not remove from the release risk register solely because it did not recur.

## Safety

Use only disposable accounts. No production user data mutation, no hardcoded tokens/passwords, no access grant by username in final code. `master` remains the Maker release branch; development stays on `product/main`.
