# Restore Learn chapter placeholder width
Status: REVIEW. Executor: Codex direct executor.
Base: 757778131900b49e98ead09ecd984b1afabc7aef. Branch: product/main. release_to_master: false.
User request: restore the first-chapter placeholder width in Learn to avoid menu resizing when switching modes.
Scope: reserve the same text/padding width as Typing's first chapter, with an invisible aria-hidden noninteractive span. Preserve Typing chapter selection.
Acceptance: equal first-chapter/spacer dimensions; stable header menu width/position for the same dictionary; Learn has no visible or focusable chapter control.
Validation: focused lint; existing header/controls browser tests; direct Chromium geometry and visual inspection.
Report: interactive/reports/TASK-20261012-018-learn-chapter-placeholder-report.md.
Keep unrelated CURRENT_TASK.md ownership. No master/EdgeOne operations.
