---
task_id: ACCOUNT-FLOW-POLISH-20261030
status: REVIEW
executor: Codex-account-flow
claim_base_commit: 750e346b3ce58c638f0cf6177a04c58fa0839f7f
target_branch: product/main
release_to_master: false
---

Owner approved the login UX review: one deliberate submit, explicit registration-only anonymous-record copy option, original-page return, consistent progress presentation, and reauthentication only when needed. Preserve pre-mount S1 ownership, guarded startup, single-active-session and all sync/merge executors. Independent assigned task; do not change CURRENT_TASK/Circle ownership or other executors' reports.

Use a presentation-only, bounded/whitelisted return context. Continue entering the existing home startup path for all authenticated returns and restore the requested UI route only AFTER its guarded boot succeeds, before app hydration. Never let a return URL or presentation flag authorize a workspace, skip recovery or skip synchronization.

Validate no login confirmation after server session issuance; cancellation before submit makes no request; registration copy/no-copy preserves anonymous storage; same-owner reauthentication; failure/replay handling; safe original-route return and passive-return optimization; Pages zero-network preview and six-profile production UI. Publish main/Pages only. No etest/master promotion.
