---
protocol_version: "1.1"
task_id: "TASK-20261006-001-header-branding"
title: "Header branding: add 云备份 text and recolor Plus"
status: "READY"
target_branch: "product/main"
base_commit: null
recommended_executor: "workbuddy"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261006-001-header-branding-report.md"
release_to_master: false
---

# TASK-20261006-001 — Header branding: add 云备份 text and recolor Plus

## Objective

Make a **small visual-only change** to the top-left Qwerty Plus branding area.

Required visible result:

```text
Qwerty Plus
打字 · 背单词 · 云备份
```

And change only the word **`Plus`** from its current blue/gray tone to a yellow that matches, or closely matches, the yellow accent already used inside the Qwerty Plus app icon.

## Context

The current page header already shows:

- Qwerty Plus
- subtitle: `打字 · 背单词`

The user explicitly clarified that this task is **not** a new Cloud Backup feature entry.

`云备份` is only added to the existing subtitle/branding text.

## Scope

### In scope

- locate the existing top-left branding/header component;
- change subtitle text from:
  - `打字 · 背单词`
  - to `打字 · 背单词 · 云备份`;
- change only the `Plus` text color to the icon's yellow brand accent;
- preserve the existing typography, layout, spacing and visual hierarchy unless a tiny spacing adjustment is necessary for the longer subtitle;
- verify both light-mode appearance and the normal header layout if the project supports theme switching.

### Out of scope

- no new page;
- no new route;
- no new clickable navigation item;
- no cloud-sync/cloud-backup business-logic change;
- no account/menu change;
- no Learn or Typing behavior change;
- no unrelated header redesign;
- no release to `master`.

## Visual Intent

The desired header is conceptually:

```text
[logo]  Qwerty Plus
        打字 · 背单词 · 云备份
```

Rules:

1. `Qwerty` keeps its current color/style.
2. `Plus` becomes yellow.
3. Prefer reusing/sampling the yellow already present in the repository's Qwerty Plus icon/logo asset.
4. Do not introduce an arbitrary high-saturation yellow if an existing brand yellow can be reused.
5. Subtitle retains its current subdued visual style; only append ` · 云备份`.
6. `云备份` has no new click behavior in this task.

## Required Work

1. Fetch latest `product/main`.
2. Read `AGENTS.md` and the active-task protocol.
3. Claim this task according to `interactive/README.md`.
4. Locate the header/logo/title/subtitle implementation and associated styles.
5. Implement the smallest robust patch.
6. Verify the rendered result locally.
7. Check narrow and common viewport widths so the longer subtitle does not visibly overlap or corrupt the header.
8. Run appropriate validation for the touched files.
9. Before push, perform the stale-head check required by `AGENTS.md`.
10. Write interactive/reports/TASK-20261006-001-header-branding-report.md.
11. Commit and push to `product/main`.

## Acceptance Criteria

- [ ] Header subtitle displays exactly `打字 · 背单词 · 云备份`.
- [ ] `Plus` is yellow and visually consistent with the yellow accent in the app icon.
- [ ] `Qwerty` remains visually unchanged.
- [ ] No new route/page/navigation semantics are introduced for `云备份`.
- [ ] No Learn/Typing/cloud-sync logic is changed.
- [ ] Header remains visually sane at normal desktop width and a narrower viewport.
- [ ] Local visual verification is recorded in the report.
- [ ] Relevant build/lint/type/test results are truthfully recorded as PASS / FAIL / NOT_RUN.

## Validation

Use the project's actual relevant commands after inspecting `package.json`/existing scripts.

At minimum:

- local visual verification;
- relevant build or type/lint validation appropriate for the touched files.

Do **not** run a deployment/release build merely for this task.

## Deliverables

- implementation;
- execution report: `interactive/reports/TASK-20261006-001-header-branding-report.md`;
- commit SHA;
- exact validation results;
- concise remaining-risk note.

## Git / Release Permissions

```text
development_branch: product/main
push_allowed: true
release_to_master: false
force_push: false
branch_deletion: false
```

## Reviewer Notes

This is intentionally the first small task under the replaceable-agent protocol.

Review should pay attention to:

- whether WorkBuddy correctly discovered the task from Git rather than requiring chat context;
- whether it stayed within the narrow display-only scope;
- whether its report is sufficient for another agent to take over.
