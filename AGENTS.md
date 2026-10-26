# Qwerty Plus — Agent Bootstrap Contract

This file is the mandatory entry point for any coding agent working in this repository.

## 1. Repository roles

- **Development:** `product/main`, auto-deployed to GitHub Pages with cloud disabled.
- **Staging:** `edgeone-test` (short: `etest`), promoted manually from `product/main` for real EdgeOne Cloud/Blob E2E only.
- **Production:** `master`, publicly released only upon explicit authorization.
- The owner completed the **first** manual `edgeone-test` deployment on 2026-10-14. This project auto-deploys future etest pushes; advance the branch only when real Cloud/Blob validation is required.
- Maker staging site is `https://t.smhe.cn/`. The owner confirms staging and production use completely independent Blob namespaces. Staging Blob is activated automatically on its first write. Canonical production Maker is `https://q.smhe.cn/`; `https://qwerty-plus.edgeone.dev/` is a retained compatibility origin, not the canonical public entry. Never use Pages to certify cloud synchronization.
- Before any master update the IDENTICAL SHA must pass published Pages regression, etest real-Cloud browser E2E and Blob transport, and the `release-ready` check. An explicit user release request remains mandatory.
- Routine development and agent coordination happen on `product/main`; NEVER bind a Maker project to its pushes.
- **Owner promotion rule (2026-10-26):** master is promoted ONLY by fast-forward to the exact commit SHA already qualified on edgeone-test. Keep the same UI and application source between etest and master; do not strip features, cherry-pick a subset, make a release-only commit, or create a divergent release branch during promotion. If master is not an ancestor, integrate normally on product/main, requalify the resulting exact SHA on etest, then fast-forward master. Test/experimental behavior differs only through trusted server branch=etest policy; never by changing code during promotion.

- **Owner independent branch policy (2026-10-26):** product/main continuously develops and may be ahead of edgeone-test; etest independently pins a candidate for real network validation and may be ahead of master. Require ancestry master -> etest -> product/main (equality is valid immediately after promotion), not identical branch heads. Release master only by fast-forward to the exact qualified etest SHA. Advancing main or its Pages preview does not revoke historical passing Pages/source CI evidence for that candidate; every accepted run must still match the candidate SHA exactly. Changing etest invalidates its previous release qualification. Never freeze development, roll back main or substitute newer-SHA evidence merely to promote an older qualified candidate.

### Server deployment identity (owner convention, 2026-10-26)

The owner configured the lower-case server environment variable `branch` in EdgeOne:

| Server variable | Deployment | Canonical host | Git branch |
| --- | --- | --- | --- |
| `branch=master` | Production | `https://q.smhe.cn/` | `master` |
| `branch=etest` | Staging / experiments | `https://t.smhe.cn/` | `edgeone-test` |

Read trusted server bindings through `runtimeEnvironment(context.env)`, including literal `process.env.branch` for Node Cloud Functions. Do not infer deployment identity from Request.url, Host, Origin, query strings or client headers: Maker may rewrite the URL and these inputs cannot authorize experiments. Global rule: ONLY exact server `branch=etest` may enable test-only features, debug controls or experimental endpoints. Every other value uses production safety defaults; no test switch may bypass authentication, ownership or storage isolation. Apply this rule to each new test-only feature. For session handoff, ONLY exact `etest` enables the existing disposable-account pilot; `master`, missing, blank or unknown values disable it before request-body classification or barrier access. An absent branch is UNKNOWN, not evidence of GitHub Pages. Pages remains identified by its existing build settings (REACT_APP_DEPLOY_ENV=pages and VITE_QWERTY_SYNC_DISABLED=true); never disable production login/sync solely because branch is missing. This does not enable handoff for ordinary accounts or grant release authority; explicit owner approval and identical-SHA gates still apply. Keep this convention available to all QWERTY executor chats.

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
- avoid unnecessary Maker builds; `product/main` changes must only build Pages
- do not advance `edgeone-test` for routine UI changes; every etest push auto-deploys and consumes a Maker build
- do not advance `master` without passing Pages AND etest for exactly the same SHA and an explicit release authorization
- GitHub Actions alone cannot block unauthorized direct pushes; configure master branch protection/rulesets when permissions allow

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

## 9. Proportionate validation (owner instruction, 2026-10-24)

Choose validation by behavioral risk, not by habit or number of available suites. For small maintenance changes, run the narrow tests that exercise the changed behavior and its safety boundary, plus scoped static checks. Do not automatically repeat the full Cloud and workspace suites, or repeat an unchanged passing suite locally and in CI. Broaden only for a new failure, affected behavior, integration conflict or unresolved concrete risk.

Changes to record identity/merge rules, schemas or migrations, authentication/ownership, durable recovery or cloud writes require the relevant data-safety contracts; a small diff is not evidence of low risk. A deprecated listener cleanup can use focused lifecycle/lease tests covering native and fallback owners, close/reload, cached-page ownership and unchanged learning rows.

Do not promote etest/master or create cloud accounts solely to clear a harmless console warning. Batch small development maintenance into the next authorized release. Existing required deployment checks and user release authorization still apply when a release is requested. Do not weaken assertions, hide failures or use blanket CI skipping to make checks appear green.
