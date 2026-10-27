# Tablet refresh recovery and landscape touch layout

Date: 2026-10-28 (Asia/Shanghai). Executor: Codex-tablet-refresh.
Base/integration head: 6fc97272d274afc67ae4a25fcb8b92c4af0f7d6f.
Target: product/main. Source complete; same-SHA CI then authorized etest release.
No master release. CURRENT_TASK.md and Circle work remain untouched.

## Owner request and confirmed failures

Refreshing during tablet learning can leave audio preparation/learning status
with no reachable actions except the interaction toggle. Owner clarified that
controls are missing/unreachable rather than click handlers universally failing.
Owner also requests a separate placement of UI for wide, short touch tablets.

Two regression paths failed before the fix:
- Supported/audio task mounting while document.hidden remains idle on foreground
  return, with no playback owner and therefore no loading timeout. Old test
  receives audio-state idle instead of an actionable tap state.
- 1024x220 constrained viewport clips the primary playback action; a full-viewport
  intersection assertion fails. The fixed-height/non-shrinking footer is cut by
  its ancestors. This is a constrained-height reproduction, not a claim that all
  physical tablets have a 220px viewport or that this is the only device cause.

Ordinary 1024x600 refresh did not reproduce missing buttons on local Chromium.
The owner's exact Huawei/iPad browser and gesture timing remain real-device
acceptance work; do not equate emulation with that acceptance.

## Changes

- Distinguish a real audio request (loading) from idle/gesture-needed states.
  Initial hidden mount and foreground return expose tap playback; focus/pageshow
  does not itself autoplay or bypass pause. Retain owner checks, stale callback
  rejection, the bounded timeout and explicit resume behavior.
- During audio preparation, give both explicit playback/retry and "先练词义".
  Fallback uses the existing task selector for the SAME allocated word and saves
  meaning-choice evidence only after a real answer. It does not fabricate played
  audio, complete/skip the word, or replace cold-recall admission rules.
- Allow the action area to shrink/scroll at constrained heights. Compact layout
  hides the decorative LEARN eyebrow; actual actions retain >=44px targets.
- Supply missing styles for the mobile header's return/pause controls and
  progress track: visible 44px controls, consistent spacing and semantic colors.
- At width >=900 CSS px and aspect ratio >=4/3, use a dedicated touch layout:
  left word/example/definition reading column; right bounded action rail with
  playback, judgments, answer choices, spelling and next actions. Header stays
  above both. Narrow/portrait windows use the phone arrangement. CSS reflows the
  same card; it never remounts the controller, changes mode or rewrites records.

## Validation

Local Playwright 1.40.1 / Chromium 120, desktop UA plus real touch emulation:

- New refresh/landscape suite: **7/7 PASS against the final production bundle**.
  Tests cover blocked and truly pending playback after refresh, actual exposure
  continuation, hidden-to-visible mount, 1024x220 reachable playback, 44px header
  controls, and 1024x600 / 1366x768 / 1180x400 separate reading/action bounds.
  Rotation to 390x844 retains the original card DOM node and review checkpoint.
- Pending-audio fallback: same word, zero attempts before answering; exactly one
  attempt after a correct meaning choice; pronunciationPlayed=false and
  mobile-task-meaning-choice evidence, no mobile-task-audio evidence. Refresh
  does not automatically add another attempt.
- Existing mobile stability plus tablet entry/rotation suites: **22/22 PASS**.
  Covers paused/stale audio callbacks, genuine request timeout, real MP3 playback,
  save failure/retry, partial input, feedback, IME, guarded restoration and desktop.
- Existing phone thumb-zone and pause controls: focused verification recorded in
  the execution session; CI runs the full unchanged phone suite as well.
- Production build and SPA route emission: **PASS**.
- Scoped ESLint and git diff --check: **PASS**.
- Full tsc is not clean (repository diagnostics outside changed source); **no
  diagnostics in the modified audio hook or practice component**.

Audio fixture correction: existing pending/stub tests previously allowed the
external host's native preload error to race synthetic playing events. Supply
the existing local MP3 bytes for those tests. Explicit rejection, late-callback,
timeout, record and pause assertions remain unchanged; real-playback testing
still uses the actual audio adapter. No gate assertions were relaxed.

The Mobile P0 Gate now also executes the refresh suite against the built
production artifact, before replacing it with the separate Pages-mode build.
Development and production layouts were inspected via local screenshots.

## Release continuation

Require successful candidate Mobile P0 CI (including production refresh tests)
and Pages deployment before advancing edgeone-test, with a lease and fast-forward.
Re-read main/etest heads before promotion; preserve concurrent work and never
roll back a newer staging candidate. The owner already authorized this tablet
work to reach etest after CI. Verify /source-commit.txt after the automatic build;
do not claim a physical-device test from that source-marker check.
