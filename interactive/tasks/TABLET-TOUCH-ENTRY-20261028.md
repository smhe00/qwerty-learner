# Landscape tablet touch entry

Status: COMPLETE. Executor: Codex-tablet-touch.
Base: 9e8d5037c68009a5d1a462e6ebbfd9b6e445ae17 (product/main).

Owner reports that a landscape tablet without keyboard/mouse cannot operate
the website. Fix the entry policy so wide, primary-touch devices get the
existing touch learning surface; preserve explicit mobile routes across
rotation/unfolding and keep mouse-first desktop entry working.

This is an independent UI task authorized by the current owner conversation.
Leave CURRENT_TASK.md and the other executor's Circle task untouched. One
executor owns this task; no changes to Circle/auth/sync/storage or release refs.

Validation: real Chromium touch emulation at landscape widths with desktop UA,
tap-only learning, active-card/checkpoint continuity across rotation, and normal
desktop Learn/Typing entry. Scoped lint, TypeScript diagnostics and build.
Report under interactive/reports/TABLET-TOUCH-ENTRY-20261028-report.md.

Completed: 5 tablet/desktop browser regressions and 3 existing phone regressions
passed, build passed, scoped lint and app TypeScript audit passed. Integrated
upstream a25eb51d3a21320a73a1bc502af95cf0fbcbfc81 without conflicts before push.
