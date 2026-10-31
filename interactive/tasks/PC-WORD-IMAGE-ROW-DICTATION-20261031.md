---
task_id: PC-WORD-IMAGE-ROW-DICTATION-20261031
status: REVIEW
base_commit: 1c8f325488764e98f573534298ca05e5f7d4c8a1
target_branch: product/main
report_file: interactive/reports/PC-WORD-IMAGE-ROW-DICTATION-20261031-report.md
release_to_master: false
---

Owner clarification: put picture and English word on the same centered row; examples and definitions must follow below, rather than beside the image. Also show images during dictation. This supersedes the previous keyboard cold-spelling image exclusion. Scope stays PC and the existing 50-image reviewed pilot.

Use a real in-flow word row in keyboard Learn/Typing dictation and desktop touch Learn. Keep word input/recording logic and all authoritative source text unchanged. Enable semantic scene cues during keyboard dictation and touch spelling; keep letters masked and use a neutral image alt while the answer is hidden. Unrevealed tap-recall and mobile retain their current image exclusion. Preserve pause/narrow/error fallbacks and centralized footer attribution, with no caption under images.

Verify center alignment to the actual word, examples/meanings below the picture row, accessible input/action/meaning in touch dictation, no added English answer leaks, successful typing completion/next image, existing original-content/pause/resize/failure boundaries, scoped lint/type/build/CSS and unchanged mandatory deployment gates. product/main only; leave Circle CURRENT_TASK, etest and master untouched.
