---
protocol_version: '1.1'
task_id: ADMIN-CONSOLE-20261030
status: REVIEW
executor: Codex-admin-console
target_branch: product/main
claim_base_commit: d5f286218a9b92c74da0a82545f563e92c0309de
report_file: interactive/reports/ADMIN-CONSOLE-20261030-report.md
release_to_master: false
---
# Independent administrator console

Owner request: give administrator a separate PC/mobile interface for usage, user statistics, feedback/replies and maintenance. No learning or progress sync. Isolate ordinary accounts.

This is a separately owner-assigned task. Do not replace CURRENT_TASK or the Circle executor's task/report.

Acceptance: separate pre-learning route/session; fresh server authorization for all admin operations; server refuses managed administrator learning reads/writes including multipart staging; bounded read-only statistics with explicit completeness/coverage; feedback/reply/status reuse existing private protocol; maintenance preview and explicit confirmation; phone/tablet/desktop light/dark production UI gate. Pages preview must make zero API calls. Preserve ordinary credentials and all existing learning data; migrate only verified legacy admin credential pointer.

Validation: targeted administrator/overview and real bundled gateway contracts, affected cloud/auth contracts; scoped lint, report baseline TypeScript issues, production builds/CSS ownership, extend mandatory UI-visible gate and execute administrator journeys. Main only; no production promotion. Real cloud acceptance remains etest work, separate from synthetic UI evidence.
