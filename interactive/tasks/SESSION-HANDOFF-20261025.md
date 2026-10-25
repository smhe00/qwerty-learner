---
task_id: SESSION-HANDOFF-20261025
status: IN_PROGRESS
executor: ChatGPT (scoped handoff prototype)
base_commit: ad092c7348260407c0c91102073c5447fffeee07
target_branch: fix/session-handoff-20261025
report_file: interactive/reports/SESSION-HANDOFF-20261025-report.md
release_to_master: false
---

# Safe single-active-session handoff

Owner authorized starting implementation after the source audit. Desired
invariant: once B receives successful login, A's previously admitted requests
cannot subsequently change the authoritative cloud state.

Scoped branch exception: product/main CURRENT_TASK is owned by the separate
IDLE-ACCOUNT-ACTIVATION executor and is frozen for its staging verification.
This task adds isolated files on a feature branch, does not replace that task,
and does not update product/main, edgeone-test or master. No production writes,
provider provisioning, paid database or credential changes are authorized here.

P0: deterministic reproductions against the unchanged backend and Blob adapter;
durable drain state machine; fail closed on unknown outcomes; PostgreSQL
reference coordinator adapter and isolated CI qualification. Retain Blob learning
payloads. A reference adapter is not a decision to migrate learning storage.

P1, before integration/promotion: authenticate takeover BEFORE creating a pending
barrier, reauthenticate under ownership, route all authority-changing operations
through one common account namespace, qualify a real coordinator/deployment,
add bounded persistent receipts and proven recovery, then real staging E2E.
Never substitute a Blob flag, local Map, expiring lease, an extra token read or
fixed sleep for a cross-instance barrier. Do not report P0 as a production fix.
