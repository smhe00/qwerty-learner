---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-CLEANUP-20261024'
task_file: 'interactive/tasks/IDLE-ACCOUNT-CLEANUP-20261024.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-CLEANUP-20261024-report.md'
target_branch: 'product/main'
status: 'REVIEW'
executor: 'Codex (single executor)'
claim_base_commit: '5cd49872e6f2a6389c0de6eebdf03725c9a7e115'
release_to_master: false
---

Owner prioritizes independent 180-day idle account/cloud-data cleanup and designates existing SMHE as administrator. Circle frontend paused. Previous BETA-CLOSEOUT-DOCS task is DONE; retain its report. No production deletion/release authorization in this task.

Implementation and local qualification complete. Activity-triggered daily request, resumable deletion, server-only administrator password and policy UI implemented. No timer service, release or real deletion. Required configuration and storage consistency limitations: docs/operations/IDLE_ACCOUNT_CLEANUP.md. See execution report for exact checks, baseline TypeScript diagnostics and deployment qualification still outstanding.
