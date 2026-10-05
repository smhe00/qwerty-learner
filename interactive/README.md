# Qwerty Plus Agent Communication Protocol

Version: **1.0**

This directory is the persistent communication bus between Chat/Architect/Reviewer and any replaceable coding agent.

## Goals

The protocol is designed so that:

1. agents can be switched at any time;
2. Chat can temporarily act as the coding agent;
3. local execution can move between Codex, WorkBuddy, DeepSeek Harness or another executor;
4. project state survives token/session exhaustion;
5. `master` release builds are protected from routine development churn.

## Directory layout

```text
interactive/
├── README.md
├── CURRENT_TASK.md
├── tasks/
│   └── TASK-YYYYMMDD-NNN-short-name.md
├── reports/
│   ├── README.md
│   └── TASK-YYYYMMDD-NNN-short-name-report.md
└── templates/
    ├── TASK_TEMPLATE.md
    └── REPORT_TEMPLATE.md
```

## Roles

### Chat / Architect / Reviewer

Responsible for:

- requirements and architecture;
- task decomposition;
- acceptance criteria;
- risk constraints;
- reviewing commits/reports;
- deciding PASS / REWORK / next task;
- release authorization.

Chat may also execute coding-agent work directly, but must follow the same task/report protocol when doing so.

### Coding Agent / Executor

Responsible for:

- fetching repository state;
- reading the active task;
- source inspection;
- implementation;
- local tests/simulation/build;
- documenting actual results;
- commit/push to the authorized development branch.

The executor must not invent product requirements that contradict the task.

### CI / Simulation / Formal Gates

These are independent evidence sources. An executor must report their real result and must not bypass or dilute them simply to obtain green status.

## Source of truth and priority

For an active coding task, instruction priority is:

1. active task file;
2. root `AGENTS.md`;
3. this protocol;
4. existing project documentation;
5. executor assumptions.

If requirements conflict, stop only the conflicting portion and record the conflict in the report. Continue all independent safe work.

## Task lifecycle

Allowed states:

```text
READY
  -> IN_PROGRESS
  -> REVIEW
  -> PASS

IN_PROGRESS -> BLOCKED
IN_PROGRESS -> PARTIAL
REVIEW      -> REWORK -> IN_PROGRESS
```

Meaning:

- **READY** — task is defined and may be claimed.
- **IN_PROGRESS** — an executor is actively working.
- **PARTIAL** — useful work/checkpoint exists, but task is incomplete.
- **BLOCKED** — progress requires an unavailable dependency or explicit user decision.
- **REVIEW** — implementation/report is ready for Chat review.
- **REWORK** — reviewer found required corrections.
- **PASS** — reviewer accepted the task.

Only Chat/Reviewer should normally mark final **PASS**.

## CURRENT_TASK semantics

`CURRENT_TASK.md` is a pointer, not the full specification.

It records:

- task ID;
- task file;
- report file;
- target branch;
- current status;
- current/recommended executor;
- last known commit;
- short next action.

An executor must always open the referenced task file.

## Task file rules

Each task must contain:

- objective;
- context;
- scope;
- out-of-scope;
- constraints;
- required work;
- acceptance criteria;
- validation commands/gates;
- deliverables;
- Git/release permissions.

Requirements should describe **observable acceptance conditions**, not merely "fix the bug".

A task may authorize changes to `master` only with an explicit line such as:

```text
release_to_master: true
```

Default is always false.

## Report rules

A report is both an execution record and a handoff checkpoint.

It must distinguish:

- facts observed;
- hypotheses;
- changes actually made;
- validation actually executed;
- validation not executed;
- remaining risk.

Never write "PASS" for a command that was not run.

For failed tests, preserve the relevant failure signature/summary and explain whether it is caused by the current patch or pre-existing.

## Agent switching / checkpoint protocol

An executor may run out of tokens, lose environment access, or be replaced.

Before handoff, when possible:

1. commit coherent work;
2. update the report with status `PARTIAL` or `BLOCKED`;
3. include the last commit SHA;
4. include exact next steps;
5. note any dirty/uncommitted files.

The replacement executor then:

```text
git fetch origin
git checkout product/main
git pull --ff-only
read AGENTS.md
read interactive/CURRENT_TASK.md
read task + report
continue from repository-visible state
```

No private conversation summary is required for correctness.

## Git policy for Qwerty Plus

### product/main

This is the normal development integration branch.

Allowed by default:

- source changes;
- tests;
- simulation/formal work;
- docs;
- task/report updates;
- normal commits/pushes.

### master

This is the deployment/release branch bound to EdgeOne Maker.

Forbidden by default:

- routine development;
- automatic syncing from `product/main`;
- "keep master current" behavior;
- repeated builds merely for testing.

A task must explicitly authorize a release before an executor touches `master`.

## Commit policy

Prefer coherent commits that can be reviewed independently.

Recommended prefixes:

```text
fix:
feat:
test:
refactor:
docs:
chore:
sim:
formal:
```

Do not hide task/report updates in unrelated commits when they materially affect handoff state.

## Validation policy

Use the strongest validation available for the change, while avoiding wasteful release builds.

Typical levels:

- static/type/lint;
- unit tests;
- deterministic simulation;
- integration tests;
- browser/E2E tests;
- build;
- formal/model checks where applicable;
- release smoke test only when release is authorized.

The active task determines which are mandatory.

## Failure and blocking policy

A task is **BLOCKED** only when required progress depends on something the executor cannot safely infer or access, for example:

- unavailable credential/service;
- required hardware/runtime;
- contradictory requirements;
- user decision with material product impact.

Lack of one optional tool is not automatically blocking. Continue all safe work and leave a precise checkpoint.

## Token/cost-aware routing

High-capability agents should be reserved for high-reasoning work such as:

- cross-module architecture;
- difficult state-machine/debug problems;
- concurrency/data-corruption risks;
- subtle review.

Lower-cost agents are appropriate for:

- mechanical refactors;
- test expansion from an established pattern;
- lint/type cleanup;
- documentation;
- repetitive fixture generation.

The protocol must remain identical regardless of executor capability.

## Release handoff

A release is a separate task. A normal development task must not implicitly release.

A release task should explicitly state:

- source commit/tag to release;
- target branch `master`;
- pre-release gates;
- expected EdgeOne build;
- smoke-test requirements;
- rollback reference.

