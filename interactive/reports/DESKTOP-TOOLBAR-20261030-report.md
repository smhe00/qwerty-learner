---
protocol_version: '1.1'
task_id: DESKTOP-TOOLBAR-20261030
status: REVIEW
executor: Codex-desktop-toolbar
claim_base_commit: e0850e326e6d89528fb607451029ade6f225324a
target_branch: product/main
release_to_master: false
source_commit: feb9576432e46b23203ca24d621158137bba4fc8
---
# Desktop menu changes from one row to two after starting Learn

## Reproduction and cause

The owner's exact one-row → narrow two-row transition is reproduced with the production Pages build, cloud disabled and the actual /qwerty-learner/ basename. The regression computes the single-row threshold from the browser's real control/font metrics and starts Learn just above it (1502px in this environment, CET-4 fixture). Before the fix, the idle menu is single; the active menu becomes stacked, and the test fails at that transition. Pausing leaves the menu stacked.

The idle Learn header has two icon-row children: pronunciation and the icon group. The shared Typing/Learn practice header added a third child: the data-typing-primary-controls wrapper, even when Skip was absent. Its parent flex row has an 8px gap. The empty child therefore increases the measured row from 484px to 492px. At the single-row threshold this pushes the unchanged controls into stacked mode; the empty wrapper remains during pause. This is a rendering-width difference, not lost learning state or an account/sync failure. The existing ResizeObserver correctly responds to the widths it is given.

Exploratory production measurements covered 1024/1280/1366/1440/1920px and nearby CET-4 thresholds. Narrow layouts can legitimately use two rows; the existing maximum header width and actual available space still govern that choice. The fix does not force a one-row layout when it cannot fit or change the accepted brand/menu/account placement.

## Change and scope

In src/pages/Typing/index.tsx, render the Skip wrapper only when Skip itself is visible (!isLearnSurface && state.isShowSkip). Skip's control, classes, click handler and availability condition remain the same. No empty group occupies a gap in either Learn or ordinary Typing. No CSS, layout measurement algorithm, scheduler, records, S1, authentication, synchronization or merge implementation changed.

Extend the existing production visible-UI journey to cover the exact threshold, start, pause/resume, narrow/widen, switch to Typing, return to Learn's intentional idle page, and explicitly resume the same saved session. It asserts equal menu/row widths, restored single-row layout, unchanged checkpoint ID/words/index and zero Pages API requests. The existing six-profile responsive journey checks touch routing independently. Extend the existing Typing Skip test to actually click Skip, verify advancement and disappearance, and verify the toolbar returns to its original width. Retain toolbar-state screenshots alongside per-state accessibility/geometry audit attachments.

Intended files: the one application JSX file; ui-visible.spec.ts; ui-visible-audit.ts (screenshot retention only); typing-lifecycle.spec.ts; this task/report. CURRENT_TASK and Circle ownership remain unchanged.

## Observed validation

| Check | Actual result |
| --- | --- |
| Production Pages negative control with new desktop test before fix | 1 expected FAIL: active menu is stacked instead of single after starting Learn. Trace and screenshot retained. |
| Final production Pages desktop regression, light + dark | 2 PASS (12.8s); final artifact capture rerun 2 PASS (10.6s). Actual app/native database, no injected session or geometry replacement. Start/pause/resume, threshold width equality, shrink/widen, mode roundtrip, preserved checkpoint and zero API requests all checked. |
| Existing production responsive layout journey | 6 PASS: phone/tablet/desktop, both themes, automatic PC narrow/wide restoration and explicit touch routes. Four expected skips belong to the desktop-only new journey on touch profiles. |
| Typing Skip conditional-control regression | 1 PASS (15.3s), installed Chromium and development app, 1100px: Skip is visible, does not overlap Pause, accepts a real click, advances the word, disappears, and restores menu width. |
| Pages production build after fix | PASS (28.57s); existing chunk-size/Browserslist/dependency directive advisories only. |
| Production CSS ownership | PASS: 2 document entries, reset index-b9212561.css, Tailwind 3.3.2. |
| Scoped ESLint: src/pages/Typing/index.tsx | PASS, zero errors/warnings. |
| git diff --check | PASS. |

Final per-state audits report zero violations and zero geometry errors. Active/narrow/restored states have an incomplete color-contrast check for the existing .focus-word-more ellipsis; this is retained rather than silently counted as a completed automated check. Manually reviewed light/dark active and short narrow-window screenshots: toolbar, word-menu glyph, account entry and continuation controls are painted, readable and unoccluded. No new issue observed; this is not a claim that automated checks prove every future UI state defect-free.

## Retained harness failures

The first exploratory preview invocation omitted REACT_APP_DEPLOY_ENV=pages. Its preview server therefore used the wrong base and returned asset 404s, producing blank pages before the test reached any application state. The corrected invocation keeps the Pages environment for both build and preview. No application code was changed to hide the setup failure.

The first fixed-source desktop run passed the layout/start/pause/resize assertions but failed a new test assumption that switching from Typing to Learn auto-starts the saved session. The screenshot showed the intentional idle Learn page, with the corrected one-row toolbar. Added the real user continuation step (click Start Learn), retaining both idle and resumed geometry assertions and the same checkpoint equality checks. Both themes then passed. No product navigation behavior or safety assertion was weakened.

## Evidence and release boundary

Supplementary local evidence: /workspace/scratch/4c3b6e25c0cf/toolbar-regression-before.log; toolbar-regression-fixed.log; toolbar-regression-final.log; toolbar-visible-artifacts.log; toolbar-typing.log; toolbar-fixed-build.log. Per-state JSON audits and screenshots are retained in toolbar-visible-artifacts and the existing CI report/artifact mechanism. Negative and intermediate failures remain in their separate output folders.

Implementation is based on unchanged main e0850e326e6d89528fb607451029ade6f225324a. Publish only development main with these six files. Do not advance etest/master for this local presentation defect. Published Pages CI after push is separate from the observed local production-bundle verification above and is not assumed to have passed. No real cloud account, production customer state or physical iOS/HarmonyOS device was used. No broader Cloud/S1 suite is required absent a new concrete failure or source change.

Implementation checkpoint: feb9576432e46b23203ca24d621158137bba4fc8 (tree 942a3498bdb1af71f7c53443b2c77c703c16c2c4). The follow-up documentation commit only records this identity. Only product/main is updated; etest/master remain pinned. The remote implementation tree is checked against the exact locally staged tree before publication.
