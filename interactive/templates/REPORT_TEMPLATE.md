---
protocol_version: "1.1"
task_id: "TASK-YYYYMMDD-NNN-short-name"
status: "IN_PROGRESS"
executor: "agent-name"
target_branch: "product/main"
claim_base_commit: null
start_commit: null
last_commit: null
upstream_head_at_handoff: null
dirty_worktree: false
---

# TASK-YYYYMMDD-NNN — Execution Report

## Executive Status

Choose one:

- `IN_PROGRESS`
- `PARTIAL`
- `BLOCKED`
- `REVIEW`

Do not mark final `PASS`; final acceptance belongs to Chat/Reviewer.

## Root Cause

### Confirmed facts

- ...

### Hypotheses / uncertainties

- ...

## Changes Made

| File | Change | Reason |
|---|---|---|
| path | summary | reason |

## Validation Executed

| Check | Command / Method | Result | Evidence / Notes |
|---|---|---|---|
| targeted regression | ... | PASS/FAIL/NOT_RUN | ... |
| unit/integration | ... | PASS/FAIL/NOT_RUN | ... |
| lint/type | ... | PASS/FAIL/NOT_RUN | ... |
| build | ... | PASS/FAIL/NOT_RUN | ... |
| simulation/formal | ... | PASS/FAIL/NOT_RUN | ... |

Never report PASS for checks that were not executed.

## Acceptance Criteria Status

- [ ] AC1 — evidence
- [ ] AC2 — evidence

## Git State

```text
branch:
claim_base_commit:
start_commit:
last_commit:
upstream_head_at_handoff:
pushed: yes/no
dirty_worktree: yes/no
```

## Branch Divergence Check

State whether `origin/product/main` moved during execution and, if so, how it was integrated and what validation was rerun.

## Remaining Risks

- ...

## Handoff / Exact Next Action

Write this so another agent can continue without the previous conversation.

1. ...
2. ...

## Blocking Dependency

If status is `BLOCKED`, state exactly what is needed. Otherwise write `None`.
