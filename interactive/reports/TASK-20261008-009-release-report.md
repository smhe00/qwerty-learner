# Acquisition incident release — 2026-10-09

User explicitly requested publication (发布). This supersedes the earlier no-release scope for TASK-20261008-009.

Validated development head before release authorization: 7b2033ed74be39423e3d123380849f2ebfb7bced. Previous master: 74235a0d7a954e7001b1bd4c95fcf0fd26a0da0a. Implementation: e086ce1b. The production source delta contains only the acquisition fix; other changes are documents, tests and formal verification configuration. Master is an ancestor, allowing a fast-forward release with no force push.

Prior validation remains applicable: 301 domain/simulation tests, 21 Learn browser tests, 8 Typing browser tests and production build passed. No source changes since validation. GitHub workflow query returned no runs for the queried commits; remote CI is not reported as passed.

Release procedure: publish this commit to product/main and master in one atomic push, triggering the master-bound EdgeOne deployment; then inspect the production asset/version and Learn response. Publication outcome will be recorded in a follow-up on product/main to avoid another release build.

Raw user diagnostic data remains private and uncommitted. The existing repository-wide formatting stash is preserved.
