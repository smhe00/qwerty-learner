---
protocol_version: '1.1'
task_id: ANONYMOUS-UV-20261030
status: IN_PROGRESS
executor: Codex-admin-console
claim_base_commit: 750e346b3ce58c638f0cf6177a04c58fa0839f7f
target_branch: product/main
report_file: interactive/reports/ANONYMOUS-UV-20261030-report.md
release_to_master: false
---
Final owner clarification: count access IDs, not people. Deduplicate ONLY within one Beijing calendar day; one ID accessing on two different days counts twice. Today is the current day's distinct-ID count; last seven days SUMS the seven daily counts including today, not a cross-day union. Only two metrics; silent background reporting; ignore failures. Use an opaque first-party cookie without account, learning or fingerprint data; do not claim real-person identification. Keep analytics out of S1/workspace storage and login/sync critical paths. Pages and automated/admin journeys do not emit analytics. Read statistics only with fresh administrator authorization; unavailable is not zero. Preserve CURRENT_TASK/Circle ownership and all newer main work. Push main with tests/report. Real-network etest verification is within this feature's scope after exact-source admission; no further master release is authorized.
