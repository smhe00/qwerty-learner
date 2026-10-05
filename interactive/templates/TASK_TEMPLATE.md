---
protocol_version: "1.0"
task_id: "TASK-YYYYMMDD-NNN-short-name"
title: "Short task title"
status: "READY"
target_branch: "product/main"
base_commit: null
recommended_executor: "any-compatible-agent"
report_file: "interactive/reports/TASK-YYYYMMDD-NNN-short-name-report.md"
release_to_master: false
---

# TASK-YYYYMMDD-NNN — Short Task Title

## Objective

State one concrete outcome.

## Context

Explain only the project context needed to execute this task without private chat history.

## Problem / Evidence

Record reproducible symptoms, logs, trace references, screenshots, failing tests, or known root-cause evidence.

## Scope

### In scope

- item

### Out of scope

- item

## Constraints

- Work on `product/main`.
- Do not touch `master` unless `release_to_master: true`.
- Do not weaken existing validation gates.
- Preserve unrelated behavior.

Add task-specific constraints here.

## Required Work

1. inspect/reproduce;
2. identify root cause;
3. implement the smallest robust fix;
4. add/adjust regression coverage;
5. run required validation;
6. write/update the report.

## Acceptance Criteria

Use observable conditions.

- [ ] AC1
- [ ] AC2
- [ ] regression case passes
- [ ] no unintended behavior change identified

## Required Validation

Record exact commands when known.

```bash
# example only — replace with actual project commands
yarn test
```

Mandatory gates:

- [ ] targeted regression
- [ ] relevant unit/integration tests
- [ ] lint/typecheck if affected
- [ ] build if required by the task

Do not run release/deployment builds merely for routine development unless explicitly required.

## Deliverables

- implementation;
- regression coverage;
- report at the path in front matter;
- commit SHA(s);
- concise remaining-risk statement.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
```

## Reviewer Notes

Reserved for Chat/Reviewer.

