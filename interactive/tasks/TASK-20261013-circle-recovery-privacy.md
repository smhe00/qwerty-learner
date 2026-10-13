---
protocol_version: "1.1"
task_id: "TASK-20261013-circle-recovery-privacy"
target_branch: "feature/circle-core-blob"
status: "PARTIAL"
executor: "Codex"
release_to_master: false
claim_base_commit: "e9c45bd215c5b56b8449e66850bde6650920d292"
---

# Continue Circle v2 — recovery and retirement maintenance

User authorized continuation under the previous feature-only, no-deployment,
no-UI/V4 constraints. Do not claim or edit the unrelated CURRENT_TASK.

Implement recoverable leave/remove/close despite fence-success/log-failure,
with immutable unique-key intentions and independent exact trusted receipts.
Implement server-only retired-identity event cleanup and honest residual audit.
No Blob/KV lock/CAS/shared RMW; no claim of complete erasure from eventual scans.

Offline acceptance: crash/restart and multiwriter replay convergence, no action
from an unfenced intent, exact receipt binding, retired replay denial, privacy
reference coverage, active-account and maintenance-denial tests, delayed records,
delete failure/stale visibility, scoped test/lint and committed checkpoint.
Production authority, inventory, orchestration and live qualification remain
separate gates. See docs/CIRCLE_RECOVERY_PRIVACY_V2.md for exact next work.
