---
protocol_version: '1.1'
task_id: ACCOUNT-PASSIVE-RETURN-20261026
task_file: interactive/tasks/ACCOUNT-PASSIVE-RETURN-20261026.md
report_file: interactive/reports/ACCOUNT-PASSIVE-RETURN-20261026-report.md
target_branch: product/main
status: IN_PROGRESS
executor: Codex
claim_base_commit: 95184f9f306fc0d04b726edc9ec53d3bca49bdef
release_to_master: true
---
用户授权：单纯查看账号后返回不触发同步；登录、重新认证和未完成事务仍同步/恢复。先etest，同SHA快进master；保留当前主线管理员工具及所有已上线UI。
