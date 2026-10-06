---
protocol_version: "1.1"
task_id: "TASK-20261007-008-learn-live-stats"
task_file: "interactive/tasks/TASK-20261007-008-learn-live-stats.md"
report_file: "interactive/reports/TASK-20261007-008-learn-live-stats-report.md"
target_branch: "product/main"
status: "REVIEW"
executor: "workbuddy"
claim_base_commit: "8b2c04ee0a336d3be696b7adb9438ac6c6df7ae1"
claimed_at_utc: "2026-10-06T23:18:08Z"
last_known_commit: "17c427c15b0998fdd732231d612c66374e9b4a12"
release_to_master: false
priority: "P1"
---

# Current Task

Learn live statistics task is ready.

- **Task:** `TASK-20261007-008-learn-live-stats`
- **Executor:** `workbuddy`
- **Status:** `REVIEW`
- **Claimed at (UTC):** `2026-10-06T23:18:08Z`
- **Claim base commit:** `8b2c04ee0a336d3be696b7adb9438ac6c6df7ae1`
- **Implementation commit:** `17c427c15b0998fdd732231d612c66374e9b4a12`
- **Report:** `interactive/reports/TASK-20261007-008-learn-live-stats-report.md`

Implementation, tests and report are complete and pushed to `product/main`.
Next action belongs to Chat/Reviewer: verify the five Learn labels against the
Typing control, then decide the two documented open questions (新学 has no
queue-membership fallback; 已复习 counts any completed persisted Learn row).
Executor must not self-approve and must not touch `master`.

## Product requirement

Learn mode replaces the Typing-oriented live strip with exactly:

```text
学习时间 | 本轮进度 | 新学 | 已复习 | 独立回忆
```

Typing mode must remain unchanged:

```text
时间 | 输入数 | WPM | 正确数 | 正确率
```

This task must use existing Learn session/evidence data and must not introduce
unnecessary persisted schema.

## Executor action

```text
git fetch origin
git checkout product/main
git pull --ff-only origin product/main
read AGENTS.md
read interactive/CURRENT_TASK.md
read the referenced task
claim -> implement -> test Learn -> test Typing control
-> stale-head check -> report -> commit -> push
```

## Branch policy

- Development: `product/main`
- Release: `master`
- `release_to_master: false`
- Do not touch `master`.
