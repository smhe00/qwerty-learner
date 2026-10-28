# Learn input Auto/Touch/Keyboard and global keyboard cues

Execution base: 3bd0a6c781ee3ff13152ec4e038dd99a3ac39896 (product/main).
Status: source complete, local validation complete; exact-SHA CI and authorized
etest deployment next. The implementation commit containing this report is the
candidate; no master promotion is authorized by this task.

## Result and scope

- Existing Learn buttons now cycle Auto -> Touch -> Keyboard -> Auto, labelled
  自动 / 触控 / 键盘. One shared preference works in desktop and mobile Learn.
- Save only this device-local preference as localStorage `learnInputMode`, outside
  workspace/cloud settings. Missing, invalid or unreadable preference uses Auto.
- Auto retains desktop keyboard defaults and the existing mobile adaptive selector.
  A trusted practice letter can adopt spelling without losing/doubling that letter.
  Explicit Touch wins over automatic spelling adoption; Keyboard selects spelling
  at eligible recall stages. Training phases and cold-probe evidence are unchanged.
- A passive capture listener observes trusted keydown anywhere in the app, including
  menus/editors and Tab/arrows/modifiers. It enables keyboard controls and visible
  keycaps without stealing editor/native activation or changing route/layout.
  Its first update runs in the next task, after current key ownership completes.
- Keyboard use is sticky in the current document (including mode changes and
  rotation), not a persisted hardware-connection claim. Refresh resets that signal;
  explicit Keyboard still shows controls. Touch controls remain available.
- Compact layouts retain keyboard hints; viewport/action area still scrolls when
  constrained. No input mode changes the scheduler, cloud schema, auth or ownership.

## Validation actually executed

- Selector suite: 4/4 passed, including three-state cycling with Enter/Space,
  same paused session, desktop sizes/themes and persisted touch/auto choice.
- Desktop tap + mobile keyboard suites after input event sequencing fix:
  21 passed; the remaining new persistence test initially timed out because Tab
  left the last focus stop for browser chrome and correctly paused on window blur.
  Changed that test to ArrowRight inside the editor; focused rerun 1/1 passed.
  Includes first-letter preservation, once-only attempts, IME/editor ownership,
  exposure/answer-reveal deferral, sticky menu-to-study hints at 390px and 1024px,
  compact 400px-high hints, explicit-touch keyboard grading, rotation and persistence.
- Affected mobile learning/stability/ergonomics/tablet-refresh suites: 40 passed,
  one mocked preview test failed because external preload failure stopped its
  synthetic playback before the edit. Isolated mocked media with local MP3 bytes;
  focused preview/compact-mode/desktop-switch regression rerun 3/3 passed.
- Same local MP3 isolation applied to desktop/mobile synthetic keyboard audio
  fixtures; assertions and actual HTML audio test remain intact.
- Shared mobile review commit contracts: 6/6 passed.
- Scoped source ESLint and git diff --check passed. Production build passed
  (18.91s), including SPA physical entries.
- Whole-repository tsc has pre-existing diagnostics outside the changed source;
  modified source has no diagnostics. This is not a claim of a clean full typecheck.
- Local browser: Playwright 1.40.1 Chromium 120. Default review config requests
  unavailable Google Chrome; a temporary local config changed only browser channel,
  preserving tests/assertions. CI uses the repository's normal Chrome configuration.

## Findings fixed / limits

An initial synchronous global signal could install new handlers while the same
keydown was still dispatching (first Enter could pause then resume). Deferring
only the passive global update fixed this; mobile ownership retains its original
first-key consume/append logic and all relevant assertions passed.

A draft test incorrectly assumed partially typed text survives a full document
reload. Existing mobile draft storage deliberately lives only in memory; this task
persists the selected input mode, not partial answers. Same-document input retention
is covered by existing navigation/rotation tests and was not changed.

No physical Huawei/iPad keyboard was tested. Browser key events signal actual
input, not physical device enumeration; virtual/accessibility keyboards may also
produce them. Native keyboard attach/detach remains unknown. No preference writes
learning records or establishes cloud release qualification.

## Handoff / release

CURRENT_TASK's unrelated Circle ownership stays intact. Upstream was fetched again
and still equals the execution base. Source files: app keyboard observer, new
learnInputMode store, two existing mode buttons/adapters and compact cue CSS.
Tests retain original grading/session assertions with explicit three-way selection.
Both CI path filters include the new observer/store/helper.

Run required CI against the exact candidate SHA, then fast-forward edgeone-test
under the existing owner authorization for this tablet iteration, with a branch
lease; verify t.smhe.cn/source-commit.txt. Do not advance master. Record deployment
SHA and CI run evidence in the user handoff; this report intentionally does not
claim future CI or live-device results.

## CI follow-up on 2f38a0a990df92a7920118aa3093b9e16da3e13c

Implementation commit: 2f38a0a990df92a7920118aa3093b9e16da3e13c.
Mobile P0 run 40636682560: build, scoped types/lint and commit contracts passed;
full mobile suite reported 67 passed / 3 failed. Three legacy mobile-p0 spelling
tests used a raw one-click `[data-mobile-interaction-toggle]` transition; the new
three-state cycle correctly stayed in Touch on its first click. Replaced those
three setup clicks with the shared explicit Keyboard selector. All task, grading,
FSRS and once-only record assertions are unchanged. Focused rerun: 3/3 passed
(11.7s). No application source change in this follow-up. Added mobile-p0.spec.ts
to Review Gate paths so changes to these shared behavior assertions trigger review.

Other completed initial-SHA CI: Pages deployment, published dual-site explorer,
Learn Real Journey, Learn Completion Journey, Mobile Menu Completion, Circle UI,
and Private Feedback UI passed. Review and workspace gates were still running
at this checkpoint; their results must not be assumed. The follow-up commit is
now the candidate; wait for its own applicable exact-SHA checks before etest.
