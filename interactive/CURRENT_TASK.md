---
protocol_version: "1.1"
task_id: "TASK-20261006-003-production-aligned-learn-sim"
task_file: "interactive/tasks/TASK-20261006-003-production-aligned-learn-sim.md"
report_file: "interactive/reports/TASK-20261006-003-production-aligned-learn-sim-report.md"
target_branch: "product/main"
status: "IN_PROGRESS"
executor: "chat"
claim_base_commit: "18092df71e490bdccbe63c61b987d04a42de16b5"
claimed_at_utc: "2026-10-06T03:25:00Z"
last_known_commit: "18092df71e490bdccbe63c61b987d04a42de16b5"
release_to_master: false
---

# Current Task

P1 production-aligned Learn simulation is active.

## Execution order

1. move shared Trace IR to neutral source module;
2. align VirtualLearnApp with production mixed-session semantics;
3. add lifecycle actions and invariants;
4. bridge P0 minimized traces into deterministic simulation seeds;
5. extend explorer and mutation sensitivity;
6. run full Review Gate and write report.

`master` must not be modified by this task.
