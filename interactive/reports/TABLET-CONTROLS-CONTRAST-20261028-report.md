# Tablet controls, contrast and Shift mode shortcut

Status: REVIEW (implemented, source CI validated, etest deployed).
Executor: Codex-tablet-ui. Branch: product/main.
Base and last observed upstream: 487303ba5721bbaf53d52c75ee1574e5976f337d.
Task: interactive/tasks/TABLET-CONTROLS-CONTRAST-20261028.md.

## Behavior and root cause

The mode button shared the scrolling answer footer. On wide/short tablets this
put a navigation choice next to grading controls. It now has a separate grid cell
at the top of the right column; answers scroll independently below it. Phone
controls retain their bottom placement. The existing mode atom/cycle is unchanged.
Muted text and translucent keycaps had insufficient contrast; the correction
control also combined a light surface with dark-theme text. Use secondary text,
opaque keycaps, themed correction/error colors and explicit input placeholder ink.

Owner steering adds a lone Shift release to cycle auto -> touch -> keyboard ->
auto on phone/tablet and desktop. The existing visible button is activated, not a
second mode state machine. Key hints and aria-keyshortcuts identify Shift. The
mobile mode button no longer advertises/accepts W; the separate desktop per-card
exercise shortcut is unchanged. Shift-letter, Shift-Tab, other modifier chords,
held/repeated Shift, IME, unrelated editors and overlays do not trigger the cycle.
Paused/hidden/disabled mobile buttons cannot be activated. Pointer/blur cancel
an armed shortcut. Spelling input is the only permitted editor for this shortcut.
No scheduler, record, cloud, account or global keyboard-intent timing changes.

## Changed files

- src/pages/Mobile/mobile-app.css: independent top grid cell and themed colors.
- src/pages/Typing/hooks/useLearnModeShortcut.ts: shared lone-Shift gesture owner.
- src/pages/Typing/components/DictChapterButton/LearnExerciseSwitcher.tsx:
  desktop button integration and hint.
- src/pages/Typing/components/WordPanel/components/MobileWordPractice.tsx:
  separate mode region and mobile shortcut integration.
- tests/e2e/tablet-refresh.spec.ts: top/gap geometry and light/dark contrast.
- tests/e2e/learn-exercise-switcher.spec.ts and mobile-keyboard-spelling.spec.ts:
  desktop, 390px phone and 1024px tablet shortcut ownership regressions.
- .github/workflows/review-gate.yml and mobile-p0-gate.yml: watch new hook;
  Review lint includes it.

## Executed validation

- Before color/placement correction, focused assertions failed on low mode
  placement and contrast (light 4.215, dark 3.640). Final tests require >=4.5.
- Final development tablet-refresh + mobile-ergonomics: 18/18 passed, 1.1m.
  Includes 1024x600, 1366x768, 1180x400, 1024x220, rotation, blocked/pending
  audio after refresh, compact phone, partial spelling and frozen learning evidence.
- Desktop header geometry in both themes at 1024/1280/1440: passed.
- New lone-Shift cases: 3/3 passed, 9.9s. Includes uppercase C, Shift+Tab,
  Ctrl+Shift, repeat, IME, editor/modal ownership, paused state and no answer rows.
  Initial test harness used literal Shift+c (Playwright emits lowercase c) and
  a landing-page letter that legitimately starts Learn; corrected to physical
  Shift+KeyC and an owned editor. No production behavior was weakened for tests.
- Final production build: passed (existing chunk-size/upstream dependency warnings).
- Production preview tablet-refresh suite: 9/9 passed, 11.4s.
- Scoped ESLint: passed. git diff --check: passed.
- Whole-project tsc: 143 diagnostics outside changed source paths, zero in changed source paths.
  This is a scoped type check, not a whole-project type-check pass.
- Visually inspected wide 1180x400 layout and dark correction screenshots.
  Environment lacks CJK glyphs; geometry/color assertions are independent of that.

## Git / continuation

No upstream divergence after fetch; source commit will parent the base above.
Unrelated Circle CURRENT_TASK remains untouched. Continuing owner CI-then-etest
instruction explicitly authorizes this UI candidate's staging update. No master
promotion. Current etest is bfe06722a11b940646bb7a63c05c7c5fb6975f75;
master ad862b392c6a935ca49514fc9df146932aa02ed2 remains untouched.

Next: commit/push intended files to product/main with expected-SHA lease; await
matching Review/Mobile/Pages checks, fast-forward edgeone-test once, verify live
https://t.smhe.cn/source-commit.txt, record exact SHA/run results in a docs followup.
No live Cloud safety qualification or real Huawei/iPad hardware claim is made.

## CI correction checkpoint

Initial source b0b95e613276d37c1d0ce5cd34dbbf4588664601 was NOT deployed.
Mobile P0 40643720937 passed (72 mobile + 9 production tablet + 57 account +
4 Pages-preview cases). Pages 40643720849, mobile menu, Circle UI, completion,
real journey and dual-site explorer also passed. Review 40643720847 failed exactly
one of 125 final browser cases: learn-shell-ui header alignment, delta 25.53125px
versus <=4px for the dictionary. All new Shift cases passed in that run.
Cause: widening the desktop mode button from 80px to 112px shifted its centered
header relative to Typing. Restore the original 80px width; stack the normal-size
mode name/icon above a 10px Shift hint inside the original 36px height. Mobile
source, hook logic and data behavior are unchanged by this correction.
Focused final desktop geometry, cross-mode alignment and Shift ownership: 3/3
passed (17.3s); scoped ESLint and whitespace check passed. No test was weakened.
Await the corrected exact-SHA Review and Pages runs before etest. Earlier Mobile
results are scoped evidence for unchanged mobile source, not new-SHA CI results.


## Corrected source CI and staging promotion

Corrected candidate: 23ae0cd00bce07a3968493559bbf9be4b9e47de3.
Exact-SHA Review Gate 40645510881 passed, including 125/125 final Learn browser
cases (6.5m), the repaired Learn/Typing alignment and all three new Shift cases.
Earlier browser stages passed 22 lifecycle, 5 audio, 5 stats, 5 stateful fuzz and
5 production-navigation cases; contract/model/lint/build steps passed too.
Exact-SHA Pages deployment/regression 40645511105, Learn Real Journey 40645510875
and Published Dual-Site Explorer 40645510919 passed. Pages Explorer 40645510931 is
an explicitly advisory supplementary workflow and was still running at promotion;
it is not claimed as passed. The unchanged mobile surface retains the prior
Mobile P0 evidence above; corrected source Review additionally revalidated mobile
keyboard behavior. No broad Mobile workflow rerun was triggered by desktop-only
markup correction.

At promotion, main was exactly the corrected candidate, etest bfe06722a11b940646bb7a63c05c7c5fb6975f75,
and master ad862b392c6a935ca49514fc9df146932aa02ed2. GitHub compare confirmed etest
was an ancestor (ahead 3, behind 0). edgeone-test advanced once using an exact
expected-head lease and force=false. Live deployment verification is pending.
Autostarted staging Cloud E2Es are release-qualification evidence only when they
finish; this UI task does not claim those pending checks or authorize master.


## Final handoff

At 2026-10-28T07:00:58+00:00, a cache-busted HTTPS request to
https://t.smhe.cn/source-commit.txt returned `23ae0cd`, matching the promoted
candidate. Prior checks returned `bfe0672` until deployment completed. This is
verified live deployment identity, not merely a successful branch push.

Source commits: b0b95e613276d37c1d0ce5cd34dbbf4588664601 and corrected final
23ae0cd00bce07a3968493559bbf9be4b9e47de3. A documentation-only main followup
records these results; etest remains pinned to the corrected source candidate.
The advisory Pages Explorer and automatically triggered staging Cloud workflows
were still running at this handoff and are not claimed as passed. A subsequent
main push may supersede the advisory explorer according to its normal concurrency
policy. No release-ready qualification or master promotion was attempted.

Acceptance: separate top tablet control; readable light/dark mobile controls;
lone Shift switching on desktop/phone/tablet with chord/IME/editor guards; no
answer record manufactured by switching; required source regressions and live
etest identity verified. No blocking dependency. Actual Huawei/iPad hardware
and native HarmonyOS integration were not tested; browser emulation and CI are
the evidence for this UI change. The original Circle task remains unchanged.

## Owner copy followup (2026-10-28)

Base ebf21bd2bfc87cde7f5d7b86ab111bba05f69e67. Owner requested removal of the
sentence 单独按 Shift 切换 and asked whether meaning-choice was new. Removed that
suffix from the mobile visible mode label and both desktop/mobile titles. Retain
Shift keycaps, aria-keyshortcuts and the shared shortcut hook unchanged. Exactly
three text-expression deletions; no task selector, audio fallback or learning
state changes. Scoped ESLint and git diff --check passed. Production build passed
in 18.59s with existing chunk warnings. No new tests for this copy-only deletion;
normal path-triggered CI will run before the authorized etest followup.

History evidence: 3bd0a6c781ee3ff13152ec4e038dd99a3ac39896 (Oct 28) added the
先练词义 entry while audio is pending/tap-required. Its parent already contains
meaning-choice in src/learn/task-selector.ts and an audio-error meaning fallback.
Thus the question type predates these tablet changes; this iteration introduced
a reachable entry to the existing task when refreshing leaves audio unavailable.
Repository is shallow; no unsupported claim of the original introduction date.

Status: IN_PROGRESS pending source CI and etest identity verification for this
copy followup. Existing source/deployment evidence above is historical only.

## Tablet Continue readability steering

Copy-only source 2c9f6a130018ef44c35c25ca589ea3fbe28d450d was pushed but not
deployed before the owner's next report: white 继续学习 text is hard to read on Pad.
The study primary and menu continue controls use accent ink (white in light mode).
Chromium reproduced white on indigo (ratio 5.959), not a confirmed white-on-white
rendering bug. Raise this control family's readability target to >=7:1 and use
normal text ink on the theme's tinted surface, with an accent border, only in the
existing wide-tablet media query. This covers exposure Continue, paused Resume,
menu Continue, and other shared primary actions. Phone and desktop layouts retain
their original palette. The single shared study controller is unchanged.

Extracted the existing color audit for reuse and added two real-browser cases
covering light/dark study, keyboard hint, hover, pause/resume and menu at 1024x600,
1180x400 and 1366x768. Store the actual app theme across navigation to avoid a test
DOM-class override racing app initialization. Baseline failed the new light-mode
contrast threshold (5.959 < 7); final development suite passed 11/11 in 36.8s,
including all prior refresh/geometry/correction cases. No answer records were
created by pause/resume or navigation. Visually inspected both themed screenshots;
CJK fonts are absent in this environment, so geometry and computed-color checks
are the available local visual evidence. Native Huawei rendering is untested.

Production build passed; production-preview tablet suite passed 11/11 in 13.8s.
Whitespace checks passed. Next: push this batched candidate, wait relevant exact-SHA
CI, update etest once, verify live SHA.
