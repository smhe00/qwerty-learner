---
protocol_version: "1.1"
task_id: "TASK-20261013-circle-event-log-v2"
target_branch: "feature/circle-core-blob"
status: "PARTIAL"
executor: "Codex"
release_to_master: false
claim_base_commit: "cfa9e33471395767be7344c43a4531ec32eba49f"
---

# Circle event log v2 — implementation handoff

Direct user assignment overrides AGENTS default product/main checkout/commit.
CURRENT_TASK remains the independent UI session-revocation task; do not claim,
alter or integrate that task during Circle work.

Scope: independent Blob event keys, stable logical deduplication, deterministic
replay and disposable views; create/join/provisional capacity, leave/remove/
close, progress, verified achievement, clap and fail-closed private reads.

Acceptance: no onlyIfNew/RMW in active kernel; 100-retry dedup and delayed/order
tests; independent authority mandatory; legacy CAS and HTTP closed; node tests
and lint; commit/push only feature. Offline core acceptance achieved.
Production authority, erasure, outbox recovery and live qualification unfinished.
Next work is specified in docs/CIRCLE_EVENT_LOG_V2.md.
