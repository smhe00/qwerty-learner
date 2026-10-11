# Configurable Learn block size

Execution base: 583c44e55df24f591aae5e60d744e61efa3f768d.
Integrated current product/main before editing; preserved its frozen daily-plan
and terminal-probe changes. No changes to the unrelated CURRENT_TASK.md.

## Behavior

Memory parameters now exposes “每阶段词数”, default 20, integer range 5–50.
The existing memoryConfig preference persists blockSize, including workspace
backup/preferences support. Older preferences merge the missing default without
changing dailyNewWordTarget. Shared normalization clamps invalid numbers at the
bounds and falls back to 20 for missing/non-numeric/non-finite values.

Fresh, pending and terminal Acquisition selection, due Review creation and mixed
selection use the configured size. A 5-word mixed block retains at least one due
Review slot instead of allocating all five reserved slots to new words. Sizes
are caps on distinct logical words; repeated learning attempts do not consume
new-word quota, and a short remaining daily workload produces a smaller block.
The existing daily new-word target and frozen daily plan remain independent.

Each new block saves its size in the ReviewRecord. Recovery uses that snapshot,
so changing settings or refreshing cannot rotate a valid 50-word block using
the old hardcoded 20-word guard or reset active progress. Changes apply to the
next block. The ordinary legacy Review generator is unchanged.

## Validation

- 339 Review/Learn/simulation contracts passed (zero failures), including
  configurable fresh/pending/mixed/review bounds, quota cap preservation,
  normalization and persisted block recovery.
- 19 Chrome tests passed in 42.7s: existing 17 Acquisition regressions and two
  new end-to-end setting cases. Each migrates old preferences to 20, clamps 2
  and 60 to 5 and 50, saves/reloads the chosen size, creates the matching real
  Learn queue, changes the setting mid-block and verifies refresh retains the
  existing block ID and word count. Added these to the official Review browser
  config so CI will run them.
- Production build passed in 6.21s.
- Changed-source ESLint: zero errors, one existing LearnPage ref cleanup warning.
- Type check retains unrelated baseline errors; no new diagnostic identities
  compared with the previously validated source.
- git diff --check passed. Final fetch showed product/main unchanged from base.

## Delivery

Development only; master remains f0ad4ec85876bb6ef35d08c2a663e091e2011eae.
No deployment or user/cloud data changes. Local hook wrapper references missing
.husky/_/husky.sh; commit uses an empty per-command hook path after manually
running validation. No CI workflows or validation assertions were disabled.

Implementation commit: 48a6d94461e3e4b5e877c52e0ded2195a4b36352 (pushed to product/main).

## Release authorization

User explicitly requested “发布” on 2026-10-11 after feature completion.
Release target: 3b36daae223f98c93e7718e896f723085ae382ee.
Includes validated upstream frozen daily cohort/terminal tail change 583c44e5
and block-size implementation 48a6d944. No account/cloud activation changes.
The earlier development-only delivery statement is superseded by this release.

## Published verification

Published master/source: 3b36daae223f98c93e7718e896f723085ae382ee.
Fast-forward pushed once; development-only authorization/results documents
remain on product/main and do not trigger extra release builds.

Actual EdgeOne HTML serves /assets/index-f957ce01.js, which loads
/assets/app-a894cbd1.js containing the 3b36daa release marker.
/api/health returned HTTP 200, ok=true, service=qwerty-sync-gateway.

Four real production Chrome checks passed: the 5-word and 50-word setting
cases (including legacy default migration, range clamping, preference reload,
matching actual Learn queues and mid-block preference changes followed by
recovery); typed-word persistence after refresh; repeated-refresh route
stability. Browser contexts were fresh and isolated; no cloud account writes.
Temporary live readiness adapter checks native IndexedDB rather than the
unavailable development-only /src/utils/db/core.ts import. All feature
assertions are identical to the committed browser regression tests.

Production Verify run 38117019774 failed on the existing stale Maker project
ID: NotFoundError / ResourceNotFound, makers-cgemngjuuwle not found. It did not
verify the actual deployed app and is not reported green. Direct source,
health and real-browser evidence confirm publication independently.
https://github.com/smhe00/qwerty-learner/actions/runs/38117019774

Feature-source CI snapshot: Architecture, Explorer V3 mutation audit,
Achievement, Dictionary and Learn Real Journey passed. Review Gate still
running; Published Dual-Site Explorer failed. The latter was already failing
on the pre-feature site's hidden cloud-account UI; no cloud/account feature
is part of this release. Local feature/browser tests and actual EdgeOne
checks passed; this report does not claim all CI checks are green.
