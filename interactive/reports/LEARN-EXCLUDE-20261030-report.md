---
protocol_version: '1.1'
task_id: LEARN-EXCLUDE-20261030
status: REVIEW
executor: Codex-learn-exclusion
claim_base_commit: f7899db7e2e745a9ae3dc92b5e9954490ee9dd0a
target_branch: product/main
release_to_master: false
---
# Removed Learn word returns later in the same round

The owner reported removing the current word with the mouse during spelling and seeing it return later in the round. The matching product action is WordPanel's Learn word menu → 移出学习计划, which promises that history remains and the word will not appear in Learn.

## Confirmed cause

WordPanel calls excludeLearningWord, prunes the live reviewRecord, and dispatches REMOVE_WORD_FROM_QUEUE. The repository records lifecycle=excluded and uses the same pruning function for unfinished durable sessions. However, pruneLearnSessionWord previously removed only words and per-word metadata, leaving spacingWords and optionalNewWords untouched. continueAcquisitionWithPractice selects new intervening practice from these frozen in-memory pools without querying lifecycle again. Deleting the acquisition state also makes a stale pool candidate look eligible again. The next supported/independent attempt can therefore enqueue the removed word in the same round, despite its persistent exclusion.

The old early return when the word was absent from words also prevented cleanup of candidate-only sessions. Existing UI coverage stopped immediately after deletion and did not exercise later filler insertion.

Direct execution of the unchanged TypeScript lifecycle module on the base commit reproduced the defect: the current queue no longer contained removed, but the assertion that spacingWords no longer contained it failed (true !== false, “excluded word remains in spacing pool”). The same-source direct check passed after the fix for both queued and candidate-only cases.

## Change

Pruning now clears both optional candidate pools plus all existing per-word maps, whether or not the word is currently queued. A candidate-only cleanup preserves the active cursor and finished flag. Actual queue removal retains the previous logical cursor behavior, removes duplicate occurrences, and finishes an empty queue. Repeated removal is a no-op returning the same object. No input snapshot is mutated.

Only the shared local session-pruning function changes in production code. Excluded lifecycle, restore semantics, learning history tables, FSRS evidence, record identities, S1, login, synchronization and merge behavior are unchanged. Both live UI and durable repository pruning benefit from the same fix. CURRENT_TASK/Circle ownership is preserved.

## Validation completed

- Four regression cases added to acquisition-regression.test.ts: each fallback pool is unable to reinsert an excluded word through the real acquisition controller; candidate-only cleanup retains the cursor and removes maps; final-word deletion clears both pools and finishes.
- Mouse/keyboard regression added to learn-acquisition-flow.spec.ts: partially type the current word, remove via the real menu/confirmation, complete the next word so optional filler is selected, continue another attempt, reload without reseeding, and inspect durable session/lifecycle/history.

| Check | Observed result |
| --- | --- |
| New four tests with ONLY the base lifecycle module substituted during esbuild bundling | 4 FAIL / 0 PASS, expected before-fix failure. Both reinsertion tests reproduced the excluded word in the next projected queue; candidate-only and empty-queue pool tests also failed. No working source was reverted for this negative control. |
| Acquisition regression + acquisition domain contracts | 37 PASS / 0 FAIL, including the four new cases. |
| Existing formal queue/exclusion/cursor checks (targeted name filter) | 2 PASS / 0 FAIL. |
| Real Chromium desktop UI, cloud disabled, development app and native IndexedDB | 2 PASS (29.3s): new partial-spelling → mouse exclusion → filler selection → subsequent word → reload/durable readback, plus existing immediate exclusion/Skip isolation journey. No API fixture substitutes the pruning or storage logic. |
| Scoped ESLint, src/learn/lifecycle.ts | PASS, zero errors/warnings. |
| Pages production build with cloud disabled | PASS (40.71s). Existing bundle-size, Browserslist and dependency directive warnings only. |
| Production CSS ownership check | PASS, two document entries; reset index-b9212561.css; Tailwind 3.3.2. |
| git diff --check | PASS. |

A direct before/after controller probe additionally showed the causal reinsertion for BOTH pools: old queue [pending,removed,other-a,pending], fixed queue [pending,other-a,other-b,pending]. Remaining candidates and valid interleaving were preserved.

The first browser launch used the repository's branded Chrome channel, which is absent in this environment; both cases failed to launch before application execution. The unchanged two test cases were then run using the installed Playwright Chromium binary with a temporary local configuration (same real app, no retries or weakened assertions). This was an environment launch failure, not a passing initial run.

Logs: /workspace/scratch/4c3b6e25c0cf/learn-exclude-before.log, learn-exclude-unit.log, learn-exclude-formal.log, learn-exclude-ui.log, learn-exclude-ui-final.log and learn-exclude-build.log. The focused four cases are in the existing acquisition-regression file, and the UI case is in the existing acquisition-flow file, so existing Review CI includes them without new blanket suites or skipped assertions. Local browser evidence uses the dev bundle; production bundle/CSS checks are recorded separately. No actual etest/master browser or physical device was exercised for this fix. No auth, cloud-write, merge or persistent schema algorithm changed, so no real-cloud deployment/account creation was needed.

## Branches / next action

Base f7899db7e2e745a9ae3dc92b5e9954490ee9dd0a. Only development main is authorized; no etest or master advance for this local scheduler fix. Focused verification is complete. Publish the five intended source/test/task/report files on current main; preserve incoming work and keep etest/master unchanged. Published Pages/CI after the push is separate from the local verification above and is not assumed to have passed.
