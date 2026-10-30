---
task_id: RESPONSIVE-DESKTOP-RETURN-20261030
status: REVIEW
executor: Codex-responsive-return
claim_base_commit: 7eb3631f1614c8c78352a13bcbcae84ba165a290
target_branch: product/main
release_to_master: false
---

# Desktop responsive return

Owner reports PC narrowing automatically enters mobile but widening leaves the mobile screen. The width/input detector already updates correctly. The narrow fallback replaces the desktop route with `/mobile`, whose explicit-route exception then permanently preserves it.

## Change

`src/app.tsx` marks only automatic mobile-home entries with the original router location. A wide mouse-first layout restores that location with `replace`, including query, hash and original router state. Explicit mobile links have no marker and retain existing behavior; phone/tablet rotation, intentional mobile study/settings and menu navigation are not redirected. Both transitions remain in the same document/writer lease and do not add history entries. No storage, learning, authentication or synchronization algorithms changed.

The existing six-profile production visible-UI gate now exercises the regression: desktop Learn and Typing across 700→701 and 390→1440, repeated transitions, original URL including query/hash, stable document/history and unchanged durable learning/account state. It also checks explicit `/mobile` preservation on mouse-first PC and wide primary-touch selection. Published Pages gains the desktop roundtrip journey with zero API requests. Per-state accessibility/painted geometry evidence remains enforced; responsive screenshots are retained by the existing audit helper.

## Validation

- Old production Pages bundle (7eb3631f application source): regression reproduced at the desktop-return URL assertion; actual URL remains `/qwerty-learner/mobile` after widening. Baseline log `/tmp/qwerty-responsive-baseline-test.log`, trace/screenshot `/tmp/qwerty-responsive-baseline-evidence`.
- Fixed Pages production build PASS (30.94 s Vite / 32.29 s command); CSS ownership PASS, 2 document entries, Tailwind 3.3.2.
- Focused six-profile Chromium visible-UI matrix PASS: 6 passed, 25.7 s, zero retries. Both desktop themes restore Learn/Typing; both phone/tablet themes retain intentional touch routes. Durable state comparison, stable timeOrigin/history length and zero Pages API requests PASS. Logs `/tmp/qwerty-responsive-fixed-test.log`, per-state audits under `test-results/ui-visible`.
- Scoped `eslint src/app.tsx` and `git diff --check` PASS. Global TypeScript retains repository baseline failures; no `src/app.tsx` diagnostic. Not claimed as a passing whole-tree typecheck.
- Source CI / actual published Pages regression pending publication of this commit; exact-source evidence must be read from its Actions run before claiming live acceptance.

Pre-publication fetch found main advanced to b69a6847 (Admin acceptance/task documentation only). Fast-forwarded the isolated worktree; all upstream files are retained. The tested application source is unchanged by that integration.

## Primary-touch follow-up

Initial implementation published as 0d4d336bb396b59158824d5190faaf1b0131b6ed. Final review narrowed the marker to **mouse-first width fallback only**. A phone/tablet automatically selecting touch home gets no desktop-return marker, so attaching a mouse later still preserves its menu. The regression now asserts no marker and uses Chromium's actual touch-emulation media change to exercise coarse→fine input, followed by a wide resize. Intentional mobile study remains unchanged.

Final Pages production build/CSS ownership PASS (29.88 s / 31.34 s). Final six-profile run: 5 passed; tablet-dark stalled at the ordinary pre-mount preparation screen on a document navigation before the new input/resize action (30-second admission wait). Preserved its original screenshot/trace under `/tmp/qwerty-responsive-final-initial-evidence`. The unchanged targeted tablet-dark rerun passed, 3.3 s journey / 5.1 s suite, zero runner retries. All six distinct profiles therefore completed the final assertions; this is not represented as an initially clean six-case run. Final exact-source CI remains required. No product boot/lease guard, test state or assertion was weakened for the rerun.

The two desktop themes were also run with responsive screenshots retained (2 passed / 19.7 s). Manually reviewed restored desktop-light and narrow mobile-dark: expected controls/text are readable and unobstructed. Axe incompletes concern the pre-existing paragraph background overlapping inline content in the Typing landing page, not a confirmed violation. Every audited state has zero confirmed axe violations and zero geometry/touch obstruction findings.

## Boundaries / handoff

Independent authorized UI task. CURRENT_TASK and Circle/Admin reports/source remain untouched. Only product/main/Pages is published; no etest/master change. Physical devices and cloud behavior are not certified by these UI checks.

While designing query/hash preservation coverage, a separate pre-existing first-visit issue was observed on the unchanged baseline: a fresh `/learn?layout=roundtrip#learn` initializes the anonymous workspace and calls `location.replace(location.href)`, but the same hash URL can remain a same-document navigation, leaving the preparation screen. The regression first completes the ordinary `/learn` admission, then checks query/hash preservation on the initialized workspace. This is not counted as a resize failure or fixed by this patch. Diagnostic: initialized RecordDB/vault and migration witness, released writer, no page error, preparation screen remains. Keep this separate from the concurrent Admin/index.tsx work; no safety guard or startup source was changed to bypass it.
