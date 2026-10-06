---
protocol_version: "1.1"
task_id: "TASK-20261006-002-trace-replay-minimizer"
task_file: "interactive/tasks/TASK-20261006-002-trace-replay-minimizer.md"
report_file: "interactive/reports/TASK-20261006-002-trace-replay-minimizer-report.md"
target_branch: "product/main"
status: "READY"
executor: null
claim_base_commit: null
claimed_at_utc: null
last_known_commit: "26e8454f519850374aaf9f3fd61c67c9a7222638"
release_to_master: false
---

# Current Task

P0 diagnostic replay infrastructure is ready to be claimed by one executor.

- **Task:** `TASK-20261006-002-trace-replay-minimizer`
- **Target:** `product/main`
- **Status:** `READY`
- **Parallel executors:** disabled
- **Release:** forbidden for this task

## Objective

Implement the P0 pipeline:

```text
Developer Trace / Incident JSON
        ↓
normalized Trace IR
        ↓
replay + invariant oracles
        ↓
anomaly signature / first bad event
        ↓
deterministic delta minimizer
        ↓
minimal replayable failure trace
```

## Important Evidence Constraint

Do **not** commit any real user incident export, backup or database dump.

Use synthetic/sanitized fixtures only.

## Next Action

Executor must:

1. fetch and checkout latest `product/main`;
2. read `AGENTS.md`;
3. read this file;
4. read `interactive/tasks/TASK-20261006-002-trace-replay-minimizer.md`;
5. claim the task under the single-writer protocol;
6. record the actual current `origin/product/main` SHA as `claim_base_commit`;
7. implement P0 without touching `master`.
