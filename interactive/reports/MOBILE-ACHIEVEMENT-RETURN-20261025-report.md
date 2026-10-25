# Mobile achievement return-button deduplication

Status: IMPLEMENTED / CI validation pending.
Base: 2ff108757399bd655fcd4c35d8232998df0dc0a0 (product/main).
Owner reported duplicated 返回 in the first two rows after entering mobile achievements.

## Scope and cause

MobileAchievementsRoute owns a top-level 返回手机首页 action. The reused FocusAchievements unconditionally rendered 返回 Learn (visible text 返回) below it. The Song collection also retained its standalone close action. This is duplicated navigation composition, not stale browser data or a sync problem.

The mobile host now explicitly passes showBackButton=false. AchievementsPage defaults it to true, forwards it to Focus, and also conditions the Song page close on it. Desktop callers are unchanged. View switching (返回简洁版), collection-detail close and award rules are unchanged. Buttons are omitted from the DOM, not merely hidden with CSS.

## Validation plan

The retained Mobile Menu Completion workflow was still bound to a removed temporary branch. Rebind it to narrowly filtered product/main changes and include the affected achievement files in its static checks. Reuse its existing suite; do not create a new temporary branch or deploy staging/production.

New regression exercises: home menu -> Focus; 320px/900px, reload and legacy narrow /achievements; Song eligibility from three synthetic past local-day attempts; Song -> Focus; sample detail close; desktop standalone return in both views. Both mobile paths require exactly one 返回手机首页, no internal exit DOM, retained 34 locked cards and exact preservation of all six tables, dictionary and checkpoint.

Local clone/test execution was unavailable because this environment could not resolve github.com. GitHub-native writes and Actions provide source/validation instead. No passing result is claimed before reading Actions evidence.

The unrelated blocked IDLE-ACCOUNT-ACTIVATION task and CURRENT_TASK.md are deliberately left intact. No auth/storage/sync/FSRS/cleanup implementation changes; no customer account access, branch deletion, master or eTest promotion.
