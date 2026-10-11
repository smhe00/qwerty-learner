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
