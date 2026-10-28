# Tablet controls, contrast and Shift mode shortcut

Status: IN_PROGRESS (local implementation validated, source CI/deployment pending).
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
- Whole-project tsc: 143 existing diagnostics, zero in changed source paths.
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
