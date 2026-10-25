# Mobile achievement return-button deduplication

Status: DONE in development; NOT released to master or edgeone-test.
Execution base: 2ff108757399bd655fcd4c35d8232998df0dc0a0 (product/main).
Validated code commit: **eb8a9121df5f973d7751110773a5033de84ca3cd**.
Owner reported duplicated 返回 in the first two rows after entering mobile achievements.

## Scope and cause

MobileAchievementsRoute owns a top-level 返回手机首页 action. The reused FocusAchievements unconditionally rendered 返回 Learn (visible text 返回) below it. The Song collection also retained its standalone close action. The same wrapper exists on production 5528f79c; this is duplicated navigation composition, not a cache or sync issue.

The mobile host now explicitly passes showBackButton=false. AchievementsPage defaults it to true, forwards it to Focus, and also conditions the Song page close on it. Desktop callers are unchanged. View switching (返回简洁版), collection-detail close and award rules are unchanged. Buttons are omitted from the DOM, not merely hidden with CSS.

Runtime changes are limited to src/app.tsx and the two achievement view components. No schema, authentication, cloud-write, FSRS, achievement-award or idle-cleanup implementation changed.

## Validation evidence

**Mobile Menu Completion run 40168280887 / job 121093698341: PASS on the exact code SHA.**
https://github.com/smhe00/qwerty-learner/actions/runs/40168280887

- Browser suite: **15/15 PASS**, retries=0, 55 seconds. The three new cases passed at mobile-achievement-navigation.spec.ts:56, :82 and :112.
- Mobile Focus: menu entry, 320px and 900px widths, rotation, reload, legacy narrow /achievements and real return to /mobile. Exactly one 返回手机首页; internal Focus/Song exit elements absent, not hidden. All 34 locked cards stay locked.
- Mobile Song: real presentation eligibility from three synthetic past local-day attempts, both widths, view switching and sample-detail close remain functional. Returning to Focus and then the mobile home preserves all six tables, dictionary and review checkpoint exactly.
- Desktop standalone: both Focus and Song retain their existing 返回 Learn action and return to /learn. Desktop embedded callers were not changed; no broader certification is inferred.
- The 12 retained menu/settings/history/backup/phonetic/account checks also passed.
- Scoped TypeScript: PASS for mobile/app/achievement surfaces. Existing diagnostics elsewhere remain; this is NOT a clean whole-repository TypeScript claim.
- Scoped ESLint: zero errors, one pre-existing unused theme warning in CollectionCard. Production build and physical mobile entry checks passed.

Artifact **12589291491**, mobile-menu-evidence-40168280887, contains real Chromium screenshots. Downloaded and visually inspected achievement-single-return-focus.png and achievement-single-return-song.png: one page-level exit at the mobile shell; the Song view-switch action remains distinct. The Song screenshot catches its existing entry animation, not a new style change.

This is browser-emulated mobile verification, not physical Huawei/iOS or live-cloud acceptance. Local shell clone failed DNS resolution for github.com; GitHub-native writes and Actions supplied execution and test evidence. No test result was inferred from a successful commit or build alone.

## Repository coordination and release boundaries

The old Mobile Menu Completion workflow was bound to a deleted temporary branch. It now runs on narrowly filtered product/main changes and includes the affected achievement files in scoped checks. Reused the existing suite instead of introducing another temporary branch/workflow. No safety assertions were weakened.

The unrelated blocked IDLE-ACCOUNT-ACTIVATION task and CURRENT_TASK.md were left intact. Before the report update, product/main was re-read at the tested code SHA; master remained 5528f79c700548e174fa153b96ff4599d7326aee, edgeone-test remained 5fa75746678eccd217a81e9e9a02ca12d6dd6ce9. Only development was advanced, without force. This final update is documentation only.

No new branch, branch deletion, user-data access, explicit cloud-test rerun, eTest promotion or production release was performed. Existing required release checks still apply to any later authorized master release.
