# Learn optional new words and five-more — completed on product/main

Execution base: `fdb5f17665492e5cada4d8609b5435ede07e7a98`.
Code commit: `e58b4ea6e99e7b1c751e2b96d21652faef146fec`, pushed to `origin/product/main`. Release to master: **false**.

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
