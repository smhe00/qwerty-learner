# Mobile product presentation refinement

Status: implementation prepared; validation and authorized release pending.
Execution base: c594f89ef01cdd3043fe704f078c40fb9c05226b.

## Changes

Home now presents one brand, 今日学习, real progress, checkpoint only when present and 开始学习/继续学习. Remove the repeated English eyebrow, teaching note, generic footer and menu descriptions that only repeat their titles. Retain account/expiry subtitle and insecure-origin warning; no artificial synced/safe guarantee.

History removes its title-repeating sentence and keeps an honest empty state, real counters and optional statistics definition. Library retains current dictionary and on-action checkpoint preservation confirmation, not permanent implementation prose. Data removes duplicated backup explanations while retaining exact restore replacement/non-merge disclosure, protected tools, success and failure feedback. Settings attaches bounds/effective timing to the affected fields, removes introductory paragraphs and browser-implementation boilerplate, and shows save state only when edited or saved. Existing confirmations, validation, callbacks and persistence behavior remain unchanged.

No schema/auth/sync/FSRS/award/idle-cleanup implementation changes in this patch. Existing desktop UI, mobile study and account security flows remain. No new branch.

## Validation plan

Existing19 Mobile Menu Completion checks plus3 new tests: home actual-progress/no-session preview; 320px Library/History/Data, exact six-table/dictionary/checkpoint preservation and restore risk disclosure; Settings unsaved cancellation, save/reload and actual dark-mode display. Retain browser screenshots, scoped TypeScript/lint and production build. Local runtime cannot resolve github.com; GitHub-native Git edits and Actions supply validation. No successful run is claimed yet.

## Release coordination

User authorized master promotion, but current etest has independent account-handoff commits absent from main. It must not be overwritten by a forced UI promotion. Compare current refs/checks and report exact remaining blockers before any release. Current production at intake5528f79c; no promotion or runtime activation has occurred in this report.
