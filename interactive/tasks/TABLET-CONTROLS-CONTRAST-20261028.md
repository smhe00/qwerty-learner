# Tablet control placement and readable text

Status: REVIEW. Executor: Codex-tablet-ui.
Base: 487303ba5721bbaf53d52c75ee1574e5976f337d.
Owner requests moving the tablet input-mode button toward the top to avoid
accidental switching, and improving text colors that are hard to read.
Keep the existing selector/controller; position only the wide tablet mode control
away from grading actions. Audit light/dark hints, keycaps, inputs and correction.
Validate geometry/contrast, short viewport/rotation and phone regression, plus build.
No scheduler, record, auth or cloud code changes. Leave unrelated Circle task alone.
Publish main and, under the continuing owner CI-then-etest instruction for this
UI iteration, deploy etest after relevant CI. No master authorization.
Report: interactive/reports/TABLET-CONTROLS-CONTRAST-20261028-report.md.

Owner steering: use a lone Shift press/release to cycle the existing mode button
on desktop/phone/tablet. Preserve uppercase/Shift+Tab/IME/editor ownership; show
Shift hints and retain the existing three-state cycle and learning evidence.

Deployed etest candidate: 23ae0cd00bce07a3968493559bbf9be4b9e47de3.
Required source CI passed; live source-commit.txt verified as 23ae0cd.
See report for exact runs, corrected initial CI failure and remaining hardware limits.

## Owner copy followup

Status: REVIEW. Base ebf21bd2bfc87cde7f5d7b86ab111bba05f69e67.
Remove the sentence 单独按 Shift 切换 from visible mode button text and titles;
keep the Shift keycap, aria-keyshortcuts and shortcut behavior. This is a copy-only
followup under the same CI-then-etest authorization. Inspect/lint/build and await
applicable source CI; no new redundant behavior tests or master promotion.
Meaning-choice question is read-only: existing task precedes 3bd0a6c; that earlier
tablet refresh fix introduced the 先练词义 entry during blocked/pending audio.

Additional owner steering during CI: tablet 继续学习 text is white and hard to read.
Base 2c9f6a130018ef44c35c25ca589ea3fbe28d450d (copy change not yet deployed).
Use explicit paired text/surface colors for wide-tablet primary study/resume and
home continue controls. Verify both themes, keycaps, hover and pause/resume at
multiple landscape sizes, preserving the original refresh regression suite.
Batch this with the copy deletion in one etest update after source CI.

Latest handoff: both followups deployed together as cc8edf230baae7514625496bbb28388c38dbff30.
Relevant source CI passed; live etest source-commit.txt verified cc8edf2.
