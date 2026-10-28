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
