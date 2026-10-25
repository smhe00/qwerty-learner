# Mobile product presentation refinement

Status: UI DONE / VERIFIED; authorized master release NOT completed.
Execution base: c594f89ef01cdd3043fe704f078c40fb9c05226b.
First implementation: d256ca5b06a8865b1c7ce6d70a70dc8d81dbc031.
Validated final runtime: **8b9cf082726679aeb49c18050141824f80a61719**.

## User-facing changes

- Home presents one brand, 今日学习, real new/review progress and 开始学习/继续学习. Remove repeated English eyebrow, teaching note, normal generic footer and menu subtitles that repeat titles. Retain actual account/expiry subtitle and insecure-origin warning. A checkpoint appears only when there is a real unfinished round.
- Visual review of the first screenshot found another long daily explanation. Daily labels are now 新词/复习; show 复习待巩固 N 词 only when N>0. Keep every canonical progress number, completed/unmastered distinction, completion condition and error/retry callback unchanged. No fabricated mastery or sync-success state.
- Library keeps current dictionary and its on-action preservation confirmation, not a permanent implementation explanation. History removes title repetition and long empty-state instruction while retaining exact counters, optional definition and invalid-row/error disclosures.
- Data removes repeated backup explanations and generic footer. Keep the existing download/validation feedback and exact warning: 恢复会替换当前记录，不会合并。请先导出备份，下一步确认后才会恢复。 All protected tool destinations and confirmation flows are unchanged.
- Settings puts range/effective-time hints beside their fields, removes introductory/browser-internals paragraphs, and displays unsaved/saved state only when relevant. Bounds, validation, save handlers, actual immediate theme behavior and existing departure confirmations remain.

Runtime edits are confined to six Mobile presentation files. No schema/auth/cloud-write/FSRS/award/idle-cleanup implementation changed. Desktop behavior and learning exit safety are untouched. No Beta/GA reliability claim was inferred from the copy changes.

## Verified evidence

Mobile Menu Completion **40191304449 / job121162687369 PASS** at exact runtime SHA8b9cf082:
https://github.com/smhe00/qwerty-learner/actions/runs/40191304449

- **23/23 Chromium tests passed**, retries=0, 1.5 minutes. Original19 navigation/account/history/backup/phonetic/achievement checks retained plus4 new copy/state checks.
- Home preview does not create a daily session; real progress and account entry remain visible, five routes remain usable and repeated instruction text is absent.
- Library/History/Data at320px preserve exact raw six-table data, current dictionary and review checkpoint. Restore replacement/non-merge and confirmation disclosures remain visible on expansion. Anonymous users are not shown a fake actionable sync state.
- Settings unsaved-link cancellation, real save/reload, field timing, genuine dark theme and no unsolicited status are exercised. Daily summary component-input test checks unchanged numeric progress, pending consolidation, absent zero-only note and real error retry.
- Existing desktop achievement navigation, mobile Focus/Song, locked awards, accessible44px chevrons and rotation checks remain passing.
- Scoped TypeScript PASS; pre-existing diagnostics outside this UI scope remain. Scoped ESLint zero errors, one pre-existing unused CollectionCard theme warning. Production build and physical mobile route-entry checks PASS. This is not a claim of a clean whole-repository typecheck.

Artifact **12598112336**, mobile-menu-evidence-40191304449, downloaded and independently checked:
ZIP SHA256 **eee27c4a2cf135d2442aa4bccfe5d82a33c7d0c76be8a52be36e52110197c423**.
Inspected actual browser Home and Settings light/dark screenshots; the final Home no longer has the long mastery/implementation paragraph. Screenshots are rendered UI, not generated mockups. Menu data proof uses synthetic profiles only; no customer learning data was accessed.

The first iteration also passed Mobile Menu Completion40190771624; its artifact12597891733 was inspected before the follow-up daily-copy refinement. Its screenshots are superseded by the exact final-code artifact above. There was no failed scoped run hidden by a retry.

## Concurrent source integration

Upstream8e5e41ac arrived after the initial UI push. It changes Learn completion qualification, tests and reports, not the UI follow-up files. Rebased the three-file follow-up on its exact tree, preserved every upstream file and advanced main with expected-SHA/non-force protection. Upstream281ed710 subsequently replaces an obsolete exact-copy expectation with actual dark-theme persistence/reload assertions. It is retained unchanged; it is not falsely reported as part of the23-test execution at the earlier SHA.

Local git/network execution was unavailable due to github.com DNS resolution. GitHub-native edits and Actions supplied validation; no local build/test success is claimed. The final checkpoint commit is documentation only. Other automatic CI checks are not represented as globally passing.

## Why master was not updated

Owner authorization exists, but release conditions do not yet exist for this source. Current staging is34a3d15f35ede8dec073fa88deaa5f3125f2ee95 and includes14 session-handoff pilot commits absent from main (common ancestor9824cc65). The feature remains fully preserved on fix/session-handoff-20261025; its task explicitly says release_to_master:false and only reserved fixture identities are enrolled. Its latest report retains a failed broader transport gate with HTTP503/v4_direct_body_read_failed; successful isolated pilot checks are not release readiness.

At the same time, the Learn completion executor committed8e5e41ac with an owner-authorized staging qualification plan: preserve the pilot in a separate staging merge and do NOT import it into product/main. Therefore this UI task did not force-reset staging, create an ancestry-only merge that discards pilot contents, or advance production with a different unqualified SHA. The planned source/deployment coordination must be resolved with that active executor before applying the same-SHA Pages/real-Cloud/Blob/release-ready process.

Last ref inspection before this report: product/main281ed710 (retains our runtime), master5528f79c, edgeone-test34a3d15f. No new branch, branch deletion, staging ref change, production change, real account creation or idle activation was performed by this UI task. CURRENT_TASK and other task reports remain intact.

**Resume without requesting release authorization again:** choose the coordinated production-eligible candidate, preserve the experimental branch separately, pass the exact-SHA deployment gates and only then promote master. Do not describe this UI delivery as already live at q.smhe.cn.
