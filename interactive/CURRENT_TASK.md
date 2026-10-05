---
protocol_version: "1.0"
task_id: null
task_file: null
report_file: null
target_branch: "product/main"
status: "IDLE"
executor: "any-compatible-agent"
last_known_commit: null
release_to_master: false
---

# Current Task

There is currently **no active coding task**.

Before starting work, Chat/Architect should create a task from
`interactive/templates/TASK_TEMPLATE.md`, then update this file to point to it.

## Default branch policy

- Development: `product/main`
- Release/deployment: `master`
- Do not touch `master` unless the active task explicitly sets `release_to_master: true`.

## Executor bootstrap

```text
git fetch origin
git checkout product/main
git pull --ff-only origin product/main
read AGENTS.md
read interactive/CURRENT_TASK.md
read the referenced task and report
execute -> validate -> report -> commit -> push
```
