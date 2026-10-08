---
protocol_version: "1.1"
task_id: "TASK-20261009-010-s1-workspace-isolation-v4"
task_file: "interactive/tasks/TASK-20261009-010-s1-workspace-isolation-v4.md"
report_file: "interactive/reports/TASK-20261009-010-s1-workspace-isolation-v4-report.md"
target_branch: "product/main"
status: "READY"
executor: "unassigned"
claim_base_commit: ""
release_to_master: false
priority: "P0"
---

# Current Task

S0.5 formal baseline is conditionally frozen, with 3x4 TLC explicitly
exploratory. S1 transaction kernel was committed in 8f7b6188, without
touching the working V1 IndexedDB. Implement Backup V4, isolated vault,
cross-tab fencing, crash recovery, then safely activate S1 workflows.

Previous TASK-20261008-009 is published to master as recorded in its
separate report/release report; retain its historical review status and files.
No master deployment is authorized for this task.
