---
task_id: LEGACY-V3-BROWSER-GATE-20261101
status: READY
executor: unassigned
base_commit: fba0d8de2e14225844be10fb1778825ff6c8c585
target_branch: product/main
release_to_etest: false
release_to_master: false
---

Recorded follow-up only; not part of the study-content release. The unchanged post-production Browser Sync Gate waits for retired learning-state-backup-v3 and its legacy cleanup fails. Run 41288548913 reproduces the failure already present on previous master in run 41019627610. Registration was not reached.

Migrate this obsolete browser fixture and cleanup to current V4 contracts. Preserve registration, write/restore, conflict, isolation and cleanup coverage; do not simply remove capability assertions or skip coverage. Use disposable accounts and qualify in staging before any production test. Do not change runtime authentication or synchronization behavior merely to satisfy the obsolete fixture. Any release requires separate authorization and normal exact-SHA qualification.
