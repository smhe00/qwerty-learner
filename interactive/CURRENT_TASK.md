---
protocol_version: "1.1"
task_id: "CODEX-P0-M4-PRODUCTION-RELEASE-20261023"
task_file: "interactive/tasks/CODEX-P0-M4-PRODUCTION-RELEASE-20261023.md"
report_file: "interactive/reports/CODEX-P0-M4-PRODUCTION-RELEASE-20261023-report.md"
target_branch: "product/main"
status: "IN_PROGRESS"
executor: "Codex (single executor)"
claim_base_commit: "01ed8574da7a231482bf6911038a1fe04e277392"
last_source_commit: "01ed8574da7a231482bf6911038a1fe04e277392"
release_to_master: true
priority: "P0"
---

# Current task — Authorized production rollout of guarded M4 adoption

Owner instruction after exact-SHA etest acceptance: “如果需要发布，你来推进”. This supersedes the historical no-master authorization boundary for this release only. Read the referenced task/report and prior M4 diagnosis report. Reuse the accepted data path and all safety checks; connect approved production origins through one policy, rerun complete safety and identical-SHA Pages/etest/release-ready, then normal fast-forward master and verify the live production three-device scenario with one unique disposable test account.

Single-active-session, guarded pre-mount writes, legacy/unsupported-state refusal and all rollback/full-V4 evidence checks remain mandatory. Do not touch existing users' accounts, relax Circle safeguards or infer complete account history from Blob listings.
