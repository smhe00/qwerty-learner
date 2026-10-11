# Learn optional new words and five-more — completed on product/main

Execution base: `fdb5f17665492e5cada4d8609b5435ede07e7a98`.
Code commit: `e58b4ea6e99e7b1c751e2b96d21652faef146fec`, pushed to `origin/product/main`. Release to master: **authorized by user on 2026-10-11**.

## Behavior

- Mixed Learn generation snapshots a bounded pool of genuinely unseen optional words outside today's frozen mandatory names. When Acquisition lacks intervening material, the shared progression helper inserts real new-word exposure with full Acquisition state, rather than labelling these words scheduler-neutral practice. Each optional identity is introduced at most once per queue.
- Optional identities are recorded separately in DailySession. They do not increase targets, milestones or the completion condition, and do not consume the fresh allowance needed for mandatory words. New words only enter the scheduler through the existing independent clean admission gate.
- After durable raw evidence establishes original-plan completion, the word controller finishes immediately even if optional follow-ups remain queued. Partial optional evidence is retained for future recovery; no mastery is fabricated.
- Optional queue state survives refresh. Lifecycle sanitation infers injected Acquisition items from their state, filters unavailable optional candidates, and block compatibility counts exclude optional interleaving from the original configured cohort.
- Completed result offers **多学五词**. A guarded click appends up to five genuinely unseen dictionary identities to the same daily session, reopens it, adds a completion milestone and continues Learn. It preserves the recurring daily target, completed blocks and active time. Already introduced optional words are not relabelled as unseen additions. Subsequent completed rounds can append again. Exhaustion displays a status; fewer than five available adds the available count. Previous-day sessions cannot be reopened.

## Validation

- Learn + Review domain contracts and system driver: **295/295 PASS**, 9 suites, 334 ms.
- Real Chrome acquisition, recovery, block-size and extra-word journeys: **30/30 PASS**, 1.0 min. New end-to-end case verifies optional exposure, midway refresh with retained identity/state, immediate original completion with optional work still unfinished, five-word extension and post-extension reload.
- Vite production build: **PASS**, 6.71 s.
- Changed source ESLint: **0 errors**, 2 pre-existing WordPanel warnings (unused TypingState and prior callback dependencies).
- TypeScript is not globally green: baseline and candidate each have **76 diagnostic identities**, **0 new identities**, compared against a clean archive of the execution base.
- An earlier browser attempt overlapped source edits and had one settings-tab detached-element timeout (29 pass/1 fail). The final fixed-source full rerun above passed all 30; no retries/test weakening.
- An intermediate controller quota calculation broke three simulator cases; baseline 41/41 established regression. Explicit optional/extra markers replaced inference from freshly reconstructed plans, and final domain/system results are all green.

## Boundaries

No changes to Typing scheduling or the release branch. Small/exhausted dictionaries still use existing legitimate final-probe/idle behavior when insufficient unseen interleaving exists. Failed final recalls remain unresolved rather than automatically mastered. Build retains existing bundle-size/Browserslist warnings.

Temporary local browser config and bundled tests were removed. Validation ran manually because the checkout pre-commit hook references missing `.husky/_/husky.sh`; commit uses only a command-scoped hook override. Unrelated CURRENT_TASK metadata is untouched.

Release branch verified unchanged at `e2e44d17ac992931ead81d8d74b694f158116536`.

## Publication

User requested 发布 after reviewing development completion. Source `e58b4ea6` passed 295 domain/system and 30 Chrome checks plus build. Release candidate includes only this feature and its documentation since prior `e2e44d17`; upstream development did not advance. Publication will fast-forward master; deployed asset and actual Chrome checks will be recorded below.


## Published verification — PASS

- Master fast-forwarded from `e2e44d17ac992931ead81d8d74b694f158116536` to **`f01305d22171b581aac96f98275d6789cc78e7a2`**; remote ref confirmed. No force push.
- Actual `https://qwerty-plus.edgeone.dev/` HTML now serves `/assets/index-d2daaccd.js`, importing `assets/app-f4b32d67.js`; application chunk contains `f01305d` and no prior `e2e44d1` marker. A transient missing asset during deployment resolved before tests.
- **Actual production Chrome 3/3 PASS, 30.4 s**: optional new-word exposure and midway reload; original target completes while optional states remain unfinished; 多学五词 adds five mandatory unseen identities without changing the recurring target; additional session survives reload; ordinary typed word is durable; repeated route reload does not grow URL. Fresh isolated contexts, no account login, no cloud writes, no development module injection or synthetic DB records. Temporary live spec/config removed.
- Existing **EdgeOne Production Verify** [38121319800](https://github.com/smhe00/qwerty-learner/actions/runs/38121319800) still fails the obsolete Makers project lookup: `NotFoundError: Makers project(makers-cgemngjuuwle) is not found`. This workflow is **not green**. Actual served assets and Chrome results above independently confirm publication. Updating unrelated hosting project configuration is outside this Learn release.
- This verification-only documentation is pushed to product/main; master remains the verified release SHA to avoid another deployment.


## Completed-day landing correction

Root cause: five-more existed only on LearnResultScreen. LearnPage always rendered Start and its preparation path only reported daily-complete, so an idle return/reload after completion offered no extension action.

- LearnPage reads the selected dictionary's persisted DailySession and verifies today's date before replacing Start with 多学五词.
- Completed-day mount does not auto-start or auto-append. Only the explicit click flushes existing persistence, loads authoritative words/states, and calls the existing five-more helper before normal preparation. Ownership guard revokes stale async claims, and state/date are checked again after reads. Exhausted dictionaries display the existing no-new-words message.
- Current unfinished/previous-day state keeps normal Start behavior; no recurring setting changes.
- Extended Chrome regression runs **both result and landing entries**, completes original work through actual typing, closes result, confirms no Start, reloads completed landing with unchanged count, then explicitly appends five and refreshes the new session.
- **11/11 Chrome PASS, 27.2 s** (2 extra-word journeys + 9 Learn shell/UI cases). **Build PASS, 6.14 s**. Scoped ESLint **0 errors, 1 existing cleanup-ref warning**. Scheduler/domain source unchanged, so the prior 295 domain/system verification remains applicable.
- Existing user authorization to publish this feature carries through this correction. Actual deployment version and live verification follow below.


### Landing correction published — PASS

- Code/release SHA **`8699f3f0ae23daf3cc2fd93bf1070a520137b927`**; master fast-forwarded from `f01305d2`. Development source had not diverged at execution.
- Actual EdgeOne HTML serves `/assets/index-e4ef3e60.js` → `assets/app-444c7283.js`; new `8699f3f` marker present, old `f01305d` absent. The transient asset 404 during deployment resolved before validation.
- **Production Chrome 4/4 PASS, 1.1 min**: result five-more; completed-day landing five-more after closing result and after reload (Start absent, frozen target unchanged before click); extension reopens today, preserves prior progress and recurring target, survives subsequent reload; durable actual keyboard word and repeated route reload smoke. No dev module injection, synthetic DB rows, login, or cloud writes.
- [Learn Real Journey Gate 38125412183](https://github.com/smhe00/qwerty-learner/actions/runs/38125412183): **SUCCESS** for this SHA. Review and dual-site workflows were still running when checked; no all-CI-green claim.
- [EdgeOne Production Verify 38125421309](https://github.com/smhe00/qwerty-learner/actions/runs/38125421309): **FAILURE** at the existing obsolete project lookup, `NotFoundError: Makers project(makers-cgemngjuuwle) is not found`. Actual resource inspection and production browser validation independently verify successful release.
- Temporary local configs/live spec removed. Verification-only report update stays on product/main to avoid another release build.


## Failed final-probe idle entry correction

The screenshot confirms Version 8699f3f with the precise terminal-exhaustion status text. The prior landing correction only recognized `status=completed`; final-probe failures intentionally keep `status=active`, so Start remained and did not append words.

- Controller persists a separate optional `executionExhausted` marker only when all planned introductions are done, no eligible deferred resume remains, and mandatory completion is still pending. Diagnostics reflect the persisted marker.
- Landing offers five-more for completed or exhausted **current-day** plans, suppresses auto-start for both and retains unresolved-word wording for exhaustion. Reload works even if the legacy snapshot previously lacked the new marker: normal preparation detects exhaustion and records it.
- Existing extension helper accepts this explicit active-idle state and clears the marker when adding words. It never completes the session or creates mastery evidence; original planned identities, unresolved state, progress and recurring quota remain intact.
- **296/296 domain/Review/system tests PASS**, 351.8 ms; new contract proves unresolved original plus five added words remain incomplete and active. **3/3 Chrome PASS**, 18.1 s, covering result, completed landing, and a deterministic failed final-probe incident (first detection, reload, explicit append). **Build PASS**, 5.40 s; scoped lint 0 errors, 1 existing LearnPage cleanup-ref warning.
- Continue the existing authorized production bug correction; served resources/live checks follow.


### Failed-probe correction published — verified

- Code/release **`c69588a08ddf47727328283cf5f303e78f13e240`**; master fast-forwarded from `8699f3f0`.
- Actual EdgeOne HTML now serves `/assets/index-ae69be3f.js` → `assets/app-0b17bc63.js`; `c69588a` present and prior `8699f3f` absent.
- **All five production browser scenarios verified across runs**: result extension; completed-day landing extension; failed final-probe idle entry, persistence through reload and explicit five-word extension with unresolved original intact; actual typed word durability; repeated reload route stability. First run had **4 PASS / 1 header-readiness timeout** (1.9 min); first scoped reload rerun had the same timeout. Diagnostic reproduction with unchanged assertions then passed (7.8 s), no page runtime error, and the final **unmodified original reload test PASS** (11.2 s). No timeout/assertion weakening. Initial intermittent page-readiness timeouts are recorded rather than claiming a first-run 5/5 result.
- Three feature checks took 26.8 s / 22.4 s / 8.6 s. Failed-probe case uses an explicit synthetic incident snapshot in a fresh anonymous incognito profile on the actual served build. Other journeys exercise real typing. No user account/cloud data touched; no dev module injection.
- [Learn Real Journey 38126629323](https://github.com/smhe00/qwerty-learner/actions/runs/38126629323): **SUCCESS**. Architecture, mutation audit and independent holdout also succeeded when checked; Review was still running.
- [Production Verify 38126632019](https://github.com/smhe00/qwerty-learner/actions/runs/38126632019): existing obsolete Makers project lookup **FAILURE**, `NotFoundError: Makers project(makers-cgemngjuuwle) is not found`.
- [Generalization Holdout G2 38126629239](https://github.com/smhe00/qwerty-learner/actions/runs/38126629239): **FAILURE** due an invalid frozen mutation locator in unchanged FSRS source (`fsrs-initial-due-delayed-extra-day occurrences=0`); baseline passed, 15 valid mutations killed, 0 survivors, 1 invalid-build. No all-CI-green claim; mutation fixture not altered for this UI/idle fix.
- Temporary bundled contracts, configs, live diagnostic files removed. Verification-only docs remain on product/main; master remains the tested release.

## Incident follow-up checkpoint: bounded unfinished-first rounds

The supplied c69588a incident has a 44-item active queue plus an optional-new pool. The add-five helper enlarged the daily cohort but never froze a separate executable round, resumed all previous pending states, and still injected optional unseen words. Optional fillers could recursively add more fillers. The footer also used recurring dailyNewTarget instead of the expanded planned count. The exporter omitted daily-session/config keys, so the exact historical daily cohort cannot be reconstructed from this file alone. No incident/user backup is committed.

Implementation freezes up to five unfinished-first identities, fills spare slots with unseen words, scopes acquisition/review selection, settlement and live stats to that round, rotates legacy expanded checkpoints retaining evidence, and disallows optional-new injection in an explicit round. Prior terminal attempts can be retried by an explicit new round without fabricating spacing evidence. Whole-day mastery stays evidence-based. Adds safe daily/config fields to future incident exports. Validation/release in progress; current task pointer remains untouched.

### Local validation complete

- Domain/Review/system contracts: **298/298 PASS**, 9 suites, 387.4 ms. Includes 32 unresolved planned words → five unfinished-only round without new target growth; unfinished review/carry-over plus fresh filling; optional unfinished priority; legacy round recovery and outside-round detection.
- Chrome: **46 distinct scenarios verified** across final runs: acquisition 17 + recovery 9 + explicit extra-round feature 4 + block-size/review 16. Combined acquisition/recovery/feature run initially had 28 PASS and 2 failures because old feature assertions expected five fresh words despite an unfinished optional word; assertions were updated to the user's unfinished-first contract. Final feature rerun **4/4 PASS, 47.2 s**; block/review **16/16 PASS, 29.8 s**. Both five-word cases finish by actual typing, one also repairs a persisted expanded queue after reload.
- Final build **PASS, 7.38 s**. Scoped source ESLint **0 errors, 2 existing WordPanel warnings**. TypeScript retains **76 existing diagnostics / 0 new normalized diagnostics**. Test files use the existing esbuild/Playwright checks because the repository ESLint parser does not support their module configuration.
- Upstream re-fetch unchanged at `e37418cd191543808bf1be035687e80d990fa082`; no other task pointer edited, no user backups included. Source commit/publication verification follows.

### Bounded unfinished-first correction published — verified

- Source/release SHA **`5cb7ac4a9d4fa74bf962861cbfd99e7c792916c6`**; product/main pushed and master fast-forwarded from c69588a. No force push or unrelated task changes.
- Actual EdgeOne HTML serves `/assets/index-9d4b9583.js` → `assets/app-1113cdd2.js`; **5cb7ac4 present / c69588a absent**. Old resources and a transient asset 404 occurred during deployment, then resolved.
- **All 6 production browser scenarios verified across runs**: two ordinary typing/reload smoke checks PASS (3.9/8.7 s); result/landing unfinished-optional-first extension and reload PASS (9.1/13.6 s); bounded failed-terminal round and repaired legacy expanded queue each completed through real typing, **2/2 PASS, 59.8 s** (29.6/29.8 s). Five unique identities, unresolved original included, no optional-new expansion, correct target, final exit verified. Synthetic terminal/legacy fixtures run only in fresh anonymous profiles; other cases use actual typing. No account/cloud writes or dev-module injection.
- Production verification failures are retained: first temporary script used a nonexistent settings selector (two timeouts; remainder interrupted), corrected to the existing accessible button. Initial terminal fixture timed out before assertions because the published DB was not initialized; final fixture initializes Learn through its actual UI before seeding. A recovery poll accessed an undefined transient cache record; it now requires an existing replacement record with a new id. Product source was unchanged during these reruns.
- Additional live-strip contracts **5/5 PASS, 8.3 s**. Old assertions expected recurring 32 even for a frozen zero/one-new-word fixture; updated to actual planned 0/1, preserving exact checks, reload invariance, count/labels and Typing control. Total local browser coverage: **51 distinct scenarios verified**. Test/report-only follow-up remains on product/main to avoid another release build.
- [Learn Real Journey 38137881014](https://github.com/smhe00/qwerty-learner/actions/runs/38137881014): **SUCCESS**; Architecture, Achievement, Dictionary, mutation audit and independent holdout also succeeded.
- [Review Gate 38137881002](https://github.com/smhe00/qwerty-learner/actions/runs/38137881002): failed its two obsolete live-strip denominator assertions; addressed and locally verified in the follow-up above. Source release SHA's historical result is not relabeled green.
- [Production Verify 38137893778](https://github.com/smhe00/qwerty-learner/actions/runs/38137893778): existing missing Makers project failure (`makers-cgemngjuuwle`). [Generalization G2 38137881179](https://github.com/smhe00/qwerty-learner/actions/runs/38137881179): unchanged frozen FSRS locator `fsrs-initial-due-delayed-extra-day occurrences=0` / invalid-build. [Dual-Site Explorer 38137881063](https://github.com/smhe00/qwerty-learner/actions/runs/38137881063): two EdgeOne visibility/readiness failures (cloud-account panel and settings header); outside the changed scheduler/strip paths, not altered here. No all-CI-green claim.
- Temporary live specs/configs removed; repository left resumable on product/main.
