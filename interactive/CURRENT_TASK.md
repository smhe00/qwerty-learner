---
protocol_version: "1.1"
task_id: "TASK-20261006-002-trace-replay-minimizer"
task_file: "interactive/tasks/TASK-20261006-002-trace-replay-minimizer.md"
report_file: "interactive/reports/TASK-20261006-002-trace-replay-minimizer-report.md"
target_branch: "product/main"
status: "IN_PROGRESS"
executor: "chat"
claim_base_commit: "e615274f4065fff0159b66814c99ca3117957739"
claimed_at_utc: "2026-10-06T02:45:00Z"
last_known_commit: "e615274f4065fff0159b66814c99ca3117957739"
release_to_master: false
---

# Current Task

P0 diagnostic replay infrastructure is actively owned by Chat under the single-writer protocol.

- **Task:** `TASK-20261006-002-trace-replay-minimizer`
- **Target:** `product/main`
- **Status:** `IN_PROGRESS`
- **Executor:** `chat`
- **Claim base:** `e615274f4065fff0159b66814c99ca3117957739`
- **Parallel executors:** disabled
- **Release:** forbidden for this task

## Current execution order

1. P0.1 input loader + schema normalization;
2. P0.2 replay state + core anomaly oracles;
3. P0.3 stable anomaly/signature format;
4. P0.4 deterministic ddmin;
5. P0.5 local CLI;
6. P0.6 synthetic fixtures/tests;
7. P0.7 exported-incident compatibility;
8. P0.8 CI integration.

## Evidence rule

Do not commit real user incident exports, backups or DB dumps.

## Next action

Inspect existing `tests/simulation/trace-ir.ts`, formal trace bridge and package scripts, then implement the loader/oracle without introducing a second incompatible trace model.
