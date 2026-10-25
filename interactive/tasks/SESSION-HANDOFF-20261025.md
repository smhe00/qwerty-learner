---
task_id: SESSION-HANDOFF-20261025
status: PARTIAL
executor: ChatGPT (scoped handoff prototype)
base_commit: ad092c7348260407c0c91102073c5447fffeee07
implementation_commit: 7f092dd7ae24220b007d508fefc77abc627cf8a9
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

P0 implemented and qualified at 7f092dd7: 20/20 local protocol/adapter tests,
50/50 CI actual-core/protocol/Blob regressions and 4/4 real PostgreSQL tests.
CI run 40164517789, both jobs success, zero skipped. Baseline tests reproduce
existing unsafe interleavings; that is NOT evidence of a production fix.
Retain Blob learning payloads. PostgreSQL is a reference coordinator adapter,
not a chosen provider or a migration of learning storage. Runtime is unchanged.

P1, before integration/promotion: authenticate takeover BEFORE creating a pending
barrier, reauthenticate under ownership, route all authority-changing operations
through one common account namespace, qualify a real coordinator/deployment,
add bounded persistent receipts and proven recovery, then real staging E2E.
Never substitute a Blob flag, local Map, expiring lease, an extra token read or
fixed sleep for a cross-instance barrier. Do not report P0 as a production fix.
