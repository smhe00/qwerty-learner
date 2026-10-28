# Mobile new-word action visibility

Status: REVIEW. Executor: Codex-mobile-actions.
Base: 40698942f81b2dc2cb0a94b732917b84e5da8ec6. Target: product/main.

Owner reports new-word learning appears stuck at 学习中 until an invisible lower-screen control is tapped. Reproduce the rendered phone UI, restore a clearly visible primary action, and verify tap progression and readable light/dark appearances on small phones and tablets. Preserve learning/save semantics and desktop Typing. Add focused browser regression covering actual computed colors, viewport reachability and progression; run scoped lint and production build. Record findings and validation in the matching report, commit and push development changes. No etest/master promotion for this routine UI fix. The unrelated CURRENT_TASK Circle executor remains untouched.
