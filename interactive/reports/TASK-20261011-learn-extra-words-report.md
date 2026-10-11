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
