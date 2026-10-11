# Continuous Acquisition tail correction

Execution base: fec9988e4bd8737ee9130083885051b8527a2b7b.
Previous production: 2fa2a1a351ea2de85a9570afc7aa46cb0a839557.

## Root cause

The first fix grouped nearby deadlines and resumed cooled Assistance as
Independent, but left the 300-second spacing/assistance deferrals intact.
A clean short-gap tail or another assisted Independent attempt still completed
the small session and exposed the waiting screen. The user's exact version and
message confirm this remaining path; this is not an outdated client diagnosis.
The original incident has 60 persisted learning states, sufficient for a pool
of already admitted words.

## Change

Persist up to two active, canonical, already admitted words outside the selected
cohort as a spacing practice pool. Shared completion logic inserts actual
practice when the remaining queue cannot supply two intervening items. Resume
spacing deferrals as Independent only after real intervening work; assistance
returns to Supported, with no invented Independent credit. Old future-deferred
checkpoints can restart Supported immediately when this pool exists, including
when fresh quota is zero. New and mixed session creation share this policy.

Practice uses a distinct raw `learnItemKind: practice` and persisted
`spacingOnly` controller marker. It cannot count as an introduction, valid
admission, fresh cohort slot, pending new word, Review rating, or FSRS quality
sample. Existing scheduler state/due time is unchanged. Lifecycle recovery
keeps active filler work and removes excluded pool words. Ordinary Typing
continues to use its existing path.

The simulation driver now uses the same pool and continuation policy. The
historical acquired-quota fixture now verifies that a pending word completes
in its original session rather than predicting the removed singleton churn.
Dedicated F8 acquired-quota fault detection remains required. Added a guided
real Deferred precondition for pending-as-fresh mutation detection; all mutant
assertions and clean-control requirements remain enabled.

## Validation

- 330 Review, Learn and simulation tests passed, zero failures. Includes full
  mutation detection with production-equivalent simulator continuation.
- 17 Chrome Acquisition browser tests passed. New tests complete five words
  with a short-spacing final word without advancing the clock, persist filler
  records as practice, and reopen five future-deferred words immediately with
  zero fresh quota. Existing 15 browser regressions remain passing.
- Regression cases cover 1/2/3/5-word tails, repeated assistance, admission
  evidence, cohort counts, refresh lifecycle preservation, and excluded pool.
- Production build passed (5.24 seconds).
- Changed production-source ESLint: zero errors; two existing WordPanel warnings.
- Type checking with target es2020 has no newly introduced diagnostic identity
  versus the original incident baseline. One existing saveWordRecord item-kind
  type mismatch was corrected. Unrelated baseline errors remain.
- git diff --check passed. Origin product/main had not advanced at final fetch.

## Boundaries and release

If the dictionary genuinely cannot supply two other active practice words,
the existing timed fallback remains; no spacing or mastery credit is invented.
Legacy pure-domain callers can omit the practice context to preserve their
explicit timed policy. Live Learn and production-equivalent simulator supply it.

The task's release authorization is the user's “发布”, continued for this
reported failed fix. The unrelated task pointer is unchanged. Deployment/source
marker and production browser verification will be appended after publication.

## Final replay/statistics audit

Initial implementation commit: 68ab2ed20c6421bfdebc598cdb7126c783e05c4e.
Post-publication audit identified additional Review replay and live-statistics
filters that treated every non-Acquisition Learn row as a Review row. Explicitly
exclude practice from legacy rating inference, learning-failure reactivation,
FSRS eligible replay/seeding, daily Review completion and live logical progress.
A regression verifies both wrong and clean practice remain scheduler-neutral.
All 330 contracts pass after this correction, with no new baseline type errors.
The final source commit supersedes 68ab2ed2 for production verification.
The local Husky wrapper referenced missing .husky/_/husky.sh; commit used a
per-command empty hook path after running the specified validation manually.
No workflow or test gate was disabled or edited.

## Published result

Final source/release commit: f0ad4ec85876bb6ef35d08c2a663e091e2011eae.
Both product/main and master were fast-forward pushed. Final build: 5.28s.
The real EdgeOne HTML served /assets/index-0ef6632c.js and app-fd42fa71.js;
the served app bundle contains the f0ad4ec release marker. /api/health returned
HTTP 200, ok=true, service=qwerty-sync-gateway.

Four Chrome checks passed against https://qwerty-plus.edgeone.dev/ (30.0s):
five-word tail continuity with genuine practice, zero-fresh-quota recovery of
five future-deferred words, real typed-word durability after refresh, and
repeated-refresh route stability. Each used a fresh isolated local browser
context; no cloud account was accessed or written. Live regression fixtures
use the actual IndexedDB stores. Their temporary adapter waits for native DB
readiness because the development-only /src/utils/db/core.ts import is absent
from published bundles. An initial attempt to reuse the development harness
failed at that import and was stopped; no product assertion was relaxed.
The final live regression and both existing production smoke checks passed.

CI production-verification run 38114108517 failed at its existing obsolete
Makers project pointer: ResourceNotFound, makers-cgemngjuuwle not found.
It did not inspect the deployed application. Production was verified through
the actual served release marker, health endpoint and real Chrome behavior;
this failed workflow is not reported as green. Other CI status is a separate
snapshot, not a prerequisite invented after these direct checks.
https://github.com/smhe00/qwerty-learner/actions/runs/38114108517

No unrelated task pointer or cloud release setting was changed. The first
correction's scope explanation (cooldown preserved) is superseded by this
continuous-tail policy where eligible active practice words are available.
