---
status: REVIEW
executor: Codex-ui-audit
target_branch: product/main
base_commit: 7c33c74ee113ea2cf0529ed9d92f2af88ff81995
release_to_master: false
---
# User-visible interface P0 audit

Owner classifies invisible mobile controls as P0 and asks for a comprehensive user-facing UI audit, repairs and prevention. This is a separate owner-directed task; leave CURRENT_TASK Circle work untouched.

Scope: audit global CSS/reset ownership and unsafe cascade patterns; built browser phone, tablet, desktop, light/dark surfaces; home/navigation, learning states and manual progression, settings, dictionaries, history, account/login/register, data/backup/sync presentation, feedback, achievements, circles and desktop auxiliary dialogs. Verify readable contrast, accessible action labels, reachable controls, clipping/overlap, scroll/short-screen handling, focus and state exits. Cover actual shipped production bundle and lazy-route sequences, not only development DOM presence. Prefer structural fixes over repeated selector patches. Use synthetic/local or mocked accounts, no real customer data. Preserve data/auth/sync contracts and learning behavior.

Deliver: inventory and evidence, repaired defects, reproducible automated visual/accessibility gate integrated in CI, report including exact tested/not-tested surfaces and physical-device limits. Build + scoped lint/static contracts + appropriate browser suites. Fetch latest before commit and push product/main; no staging/production deployment in this task. Do not claim all possible UI/browser states proven or promise zero future bugs.

Validation: production matrix 64 passed / 8 device-inapplicable skipped, 360 audited states; original built touch regressions 17 passed; menu/navigation 23 passed; sync/account/Typing/achievement support 19 passed; targeted screenshot review 6 passed. TypeScript 143 baseline / 143 current / 0 new. Report: interactive/reports/UI-VISIBILITY-P0-20261029-report.md.

Implementation commit: 61ddaa4121e2eddae19ebfaa726de6f003de4a0f. Final status REVIEW; reviewer acceptance and real-device verification remain separate.
