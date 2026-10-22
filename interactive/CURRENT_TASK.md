---
protocol_version: "1.1"
task_id: "TASK-20261022-017-multi-device-convergence-resume"
task_file: "interactive/tasks/TASK-20261022-017-multi-device-convergence-resume.md"
report_file: "interactive/reports/TASK-20261022-017-multi-device-convergence-resume-report.md"
target_branch: "product/main"
status: "IN_PROGRESS"
executor: "ChatGPT (direct executor)"
claim_base_commit: "3547113f08333880fe5f9490b4afc730851b1e86"
last_source_commit: "29577befc7f0d0fd53a49caf8d8c900442ef0698"
release_to_master: false
priority: "P0"
---

# Current task — Complete original auto-convergence without discarding proven merge

Resume from exact 959b8c9 tree after safe 3547113 recovery. Existing six-table FSRS replay, verified V4 CAS and M4 journal MUST be reused; do not replay nine withdrawn experimental commits. First read referenced task, report and final checkpoint in docs/sync/M2_M3_M4_ACCOUNT_CONVERGENCE_2026-10-21.md. Code currently adds only an etest-scoped declaration boundary and tests, not automatic V4 adoption.

The former forced-session-revocation task remains in interactive/tasks and must not be accidentally reverted as collateral development. No master release authorization.
