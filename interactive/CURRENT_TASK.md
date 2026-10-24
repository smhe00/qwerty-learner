---
protocol_version: '1.1'
task_id: 'CODEX-P1-LOGIN-STARTUP-LATENCY-20261024'
task_file: 'interactive/tasks/CODEX-P1-LOGIN-STARTUP-LATENCY-20261024.md'
report_file: 'interactive/reports/CODEX-P1-LOGIN-STARTUP-LATENCY-20261024-report.md'
target_branch: 'product/main'
status: 'IN_PROGRESS'
executor: 'Codex (single executor)'
claim_base_commit: 'b780a160c3bd1e4dc92096033f44589ef32c65ef'
release_to_master: true
---

Owner explicitly authorizes fixing slow login/startup, especially repeated full-V4 and historical event reconciliation. Preserve existing data, lossless verification, exclusive ownership and durable recovery. Main -> etest focused validation -> master; proportionate validation, no production test-account writes.
