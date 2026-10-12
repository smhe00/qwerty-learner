# Learn first-chapter placeholder — report

Status: REVIEW. Executor: Codex direct executor. Date: 2026-10-12.
Repository: smhe00/qwerty-learner. Branch: product/main.
Base: 757778131900b49e98ead09ecd984b1afabc7aef.
Implementation commit: a48ef06892955e8d8a8412749fb79b4d6b6f194b

Learn now reserves an invisible first-chapter span with the same text, font size and padding as Typing's first-chapter button. It remains aria-hidden and non-focusable; Typing chapter selection is unchanged. This stabilizes the existing right-aligned header when switching modes.

## Validation

- Focused component ESLint: PASS, exit 0.
- Existing Chromium header/controls/narrow-viewport tests: 3/3 PASS, 18.6s.
- Direct installed-Chrome geometry: first chapter and Learn spacer both 79.578125px wide and 36px tall at all three widths.
- At 1440px: Typing/Learn nav x=364.546875, width=871.953125, identical.
- At 1280px: Typing/Learn nav x=301.53125, width=774.96875, identical.
- At 1024px: Typing/Learn nav x=301.53125, width=518.96875, identical.
- Learn spacer computed visibility=hidden, aria-hidden=true, tabIndex=-1.
- git diff --check: PASS.
- Updated an existing header assertion to accept Settings on a later wrapped row; the latest right-aligned main layout makes an x-only ordering check invalid. Dictionary/pause alignment checks remain intact.
- No full unit/build rerun for this small layout change; real Vite compilation and Chromium rendering were exercised.

The unrelated CURRENT_TASK.md ownership is retained. Only product/main is pushed. No master sync or EdgeOne release.
Local screenshot: .review-test/learn-chapter-placeholder.png.
