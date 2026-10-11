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
