---
protocol_version: "1.1"
task_id: "TASK-20261006-006-learn-key-wrong-audio-regression"
task_file: "interactive/tasks/TASK-20261006-006-learn-key-wrong-audio-regression.md"
report_file: "interactive/reports/TASK-20261006-006-learn-key-wrong-audio-regression-report.md"
target_branch: "product/main"
status: "READY"
executor: "workbuddy"
claim_base_commit: null
claimed_at_utc: null
last_known_commit: null
release_to_master: false
priority: "P0-regression"
---

# Current Task

A new field regression is active.

- **Task:** `TASK-20261006-006-learn-key-wrong-audio-regression`
- **Task file:** `interactive/tasks/TASK-20261006-006-learn-key-wrong-audio-regression.md`
- **Executor:** `workbuddy`
- **Status:** `READY`
- **Priority:** P0 regression

## User symptom

In the latest Learn flow:

- normal typing/key sound has disappeared;
- wrong-letter/error sound has disappeared.

The executor must reproduce the runtime behavior before fixing it and must add executable
regression coverage.

## Executor action

```text
git fetch origin
git checkout product/main
git pull --ff-only origin product/main
read AGENTS.md
read interactive/CURRENT_TASK.md
read the referenced task
claim task according to interactive/README.md
reproduce -> diagnose -> fix -> regression test -> validate
-> stale-head check -> report -> commit -> push
```

## Branch policy

- Development: `product/main`
- Release/deployment: `master`
- `release_to_master: false`
- Do not touch `master`.
