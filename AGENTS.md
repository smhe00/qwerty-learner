# Qwerty Plus — Agent Bootstrap Contract

This file is the mandatory entry point for any coding agent working in this repository.

## 1. Repository roles

- **Development branch:** `product/main`
- **Release branch:** `master`
- `master` is the public/release branch, **not** the upstream development branch.
- EdgeOne Maker is bound to `master`. Do **not** merge/sync/push `product/main` to `master` unless the active task explicitly authorizes a release.
- Routine development, tests, simulation, documentation and agent coordination happen on `product/main`.

## 2. Control architecture

Qwerty Plus uses a replaceable-agent workflow:

```text
Chat / Architect / Reviewer
        |
        v
GitHub task protocol (interactive/)
        |
        v
Replaceable Coding Agent
(Codex / WorkBuddy / DeepSeek Harness / Chat acting as agent / others)
        |
        v
code + tests + report + commit
        |
        v
Chat / Reviewer
```

**GitHub is the persistent source of coordination state.**
No agent may keep project-critical state only in its conversation/session.

## 3. Mandatory startup sequence

Before modifying code:

1. `git fetch origin`
2. checkout `product/main`
3. `git pull --ff-only origin product/main`
4. read this `AGENTS.md`
5. read `interactive/CURRENT_TASK.md`
6. read the referenced task file
7. if the task is resumed, read its referenced report/checkpoint
8. inspect current source and Git state before editing
9. record the current `origin/product/main` commit as the execution base

Do not infer the active task from chat history alone.

### Single-writer rule

By default, exactly **one executor** owns an active task.

- If `CURRENT_TASK.md` is `READY`, an executor may claim it by recording itself and the current base commit.
- If it is `IN_PROGRESS` under another executor, do not start a second implementation unless Chat/Reviewer explicitly reassigns the task or the task allows parallel executors.
- Agent replacement is a handoff, not parallel execution.

## 4. Mandatory completion sequence

Before handing work back:

1. run the task's required validation
2. update/write the task report under `interactive/reports/`
3. record exact test/build/simulation results
4. record commit SHA(s), changed files and remaining risks
5. `git fetch origin` again and check whether `origin/product/main` advanced
6. safely integrate upstream development changes if needed; never force-push
7. rerun validation affected by integration
8. commit all intended changes to `product/main`
9. push to GitHub unless the task explicitly says otherwise
10. leave the repository in a resumable state

If `origin/product/main` moved incompatibly while the task was running, do not overwrite it. Record the divergence and hand back a `BLOCKED` or `PARTIAL` checkpoint as appropriate.

## 5. Safety rules

Unless an active task explicitly overrides them:

- never modify or push `master`
- never force-push
- never rewrite shared history
- never delete branches/tags
- never commit secrets, tokens, credentials or user backups
- never weaken tests/gates merely to make CI pass
- never silently change Typing/upstream behavior while fixing Learn
- avoid unnecessary EdgeOne builds
- do not perform repeated release builds from `product/main`

If a task conflicts with these defaults, the task must state the override explicitly.

## 6. Replaceability requirement

Any executor must assume it may be replaced at any time.

Therefore every non-trivial task must leave enough repository-visible state for another agent to continue without the previous agent's private context. Use reports/checkpoints for:

- root cause found
- files already inspected/changed
- validation already run
- known failures
- exact next action
- current commit SHA
- current upstream `product/main` SHA

## 7. Communication protocol

The normative protocol is:

- `interactive/README.md`
- `interactive/CURRENT_TASK.md`
- `interactive/templates/TASK_TEMPLATE.md`
- `interactive/templates/REPORT_TEMPLATE.md`

If there is any conflict, the active task has highest priority, then this file, then `interactive/README.md`.

## 8. Minimal agent command

For a fresh executor, the intended bootstrap is:

```text
Fetch the repository, checkout product/main, read AGENTS.md and
interactive/CURRENT_TASK.md, execute the referenced task exactly,
run required validation, update the report, commit and push.
```
