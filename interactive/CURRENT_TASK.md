---
protocol_version: "1.1"
task_id: "TASK-20261006-001-header-branding"
task_file: "interactive/tasks/TASK-20261006-001-header-branding.md"
report_file: "interactive/reports/TASK-20261006-001-header-branding-report.md"
target_branch: "product/main"
status: "READY"
executor: "workbuddy"
claim_base_commit: null
claimed_at_utc: null
last_known_commit: null
release_to_master: false
---

# Current Task

The active task is:

- **Task:** `TASK-20261006-001-header-branding`
- **Task file:** `interactive/tasks/TASK-20261006-001-header-branding.md`
- **Recommended executor:** `workbuddy`
- **Status:** `READY`

## Executor action

```text
git fetch origin
git checkout product/main
git pull --ff-only origin product/main
read AGENTS.md
read interactive/CURRENT_TASK.md
read the referenced task
claim task according to interactive/README.md
execute -> validate -> stale-head check -> report -> commit -> push
```

Do not rely on external chat context for task details. The task file is the execution specification.

## Branch policy

- Development: `product/main`
- Release/deployment: `master`
- This task has `release_to_master: false`.
- Do not touch `master`.
