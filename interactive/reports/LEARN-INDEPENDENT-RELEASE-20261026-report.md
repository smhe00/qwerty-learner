---
task_id: LEARN-INDEPENDENT-RELEASE-20261026
status: IN_PROGRESS
release_to_master: true
---

# Independent completion release

Owner explicitly authorizes an independent completion fix and production publication after verification, keeps session-handoff staging-only, and accepts intermittent503 as nonblocking. This does not authorize ambiguous replay or falsely marking tests green. Preserve all failed evidence and real learning data.

## Historical-login cause established for the current revision0 symptom

Latest failed GitHub case40233323110 on9620e33c stopped at first.revision expected1/actual0. Its previous diagnostic lacked upload response information, so neither propagation lag nor a merge defect could be inferred.

Instrumented the same deployed account UI with redacted response status/error enums only. A new disposable account with1,472,401 bytes of synthetic Unicode history reproduced the EXACT first-upload failure in41.1s. Auth/login200, meta200, binary/direct503 code v4_direct_body_read_failed, then meta200 still revision0; startup status pending. The original strict equality assertion for all six local tables PASSED before the revision assertion failed. Cleanup200/accountDeleted=true. One account, no upload replay. No real user records were read or changed. Evidence: evidence/LEARN-INDEPENDENT-RELEASE-20261026/history-initial-upload-9620e33c.json.

Code confirms cloud-functions/api/[[default]].js catches an untyped request-body read failure and returns this503 BEFORE service.putSyncV4Binary. checkAccountV4AfterAuthentication catches the error and retains pending while permitting local learning. The test only required that POST was sent, then assumed revision1; sending is not successful persistence. The diagnostics whitelist omitted this error code, causing the older generic unknown to hide the cause. No merge/data-loss evidence appears in this reproduction, and this is covered by the owner's accepted503. The lower-level reason the runtime could not read the request stream is not established and is outside this release; older5-vs4 failures are not retroactively claimed solved.

## Original candidate (superseded; never published)

Production base5528f79c. Cherry-picked only da343d41 into isolated release/learn-completion-20261026 (initial cherry-pickb9ad262c): runtime diff is EXACTLY five approved files, src/index.tsx, Learn page/result, learn-block-sync and its UI. All cloud-functions and unrelated UI match production. No session-handoff gateway and no new code-managed idle activation ship. Main remains independent.

Release workflow support binds Pages to this explicitly named candidate branch instead of moving main. It keeps the same immutable commit across source ref, actual Pages artifact/deployed marker, etest, real browser/Blob and HARD three-device convergence. A new scope guard rejects ANY other runtime path/base/branch. Ordinary main branch verification remains its default. Etest trial9620e33c is retained in a separate backup ref; staging will be used temporarily for the independent candidate, then restored by a forward commit after publication. No force push.

Local candidate checks so far: completion browser12/12 PASS82.43s including Yarn; authorization8/8 plus Pages deployment11/11 plus release-scope7/7, total26/26. Source ESLint0 errors/4 existing warnings. Script ESLint requires explicit module parser because the repository config does not cover scripts/*.mjs. Actual Pages/build/cloud qualification and production publication remain pending. No master change has occurred at this checkpoint.

## Concurrent production update and revised approved scope

Other executor released9620e33c under separate owner authority. This task did not perform that release. Owner now explicitly authorized preserving all new production features while removing only handoff from production. Abandoned old-base candidateb9ad262c remains local; not pushed. Replacement uses code-owned policy false before all experimental request processing; development/staging policy remains true. Final exact-SHA validation/publication pending.

New scope local gateway regressions:13/13 PASS (12 staging experiment contracts plus1 production-off auth/V4/session/cleanup journey). Scoped ESLint0 errors. No application UI or cleanup implementation changed.

## Final scope based on owner-provided deployment variable

Owner configured branch=master for production and branch=etest for test. Replace static candidate policy with exact server deployment binding. Missing/unknown values disable experiment; request Host/Origin/headers cannot enable it. runtime-environment adds only literal process.env.branch fallback, preserving all other configuration.18767e32 branch is superseded, never pushed to etest/master. Normal product/main/etest same-SHA gates retained unchanged. etest trial no longer needs interruption or restoration. Production preserves9620e33c UI/completion/cleanup.

Final environment-aware local targeted contracts24/24 PASS. CI f3b999dd ran806 contracts:805 passed, exceptional handoff fixture lacked newly required branch=etest and correctly saw disabled health. Corrected only that synthetic server context, retained all barrier/disconnect assertions. No HTTP503 waiver used for this test failure. AGENTS.md and owner-requested cross-chat project memory now record the branch convention.

Final local full backend806/806 PASS17.55s; real completion browser12/12 PASS72.45s on environment-aware source. Unknown branch is explicitly NOT Pages; owner agreed to preserve existing Pages build flags and normal production login/sync when the variable is absent.

## Published candidate a3098622 and current blocker (2026-10-26)

Implementationa30986221680c504e3401ea4a568d7bd628bb552 advanced main and etest through normal pushes. Production remains9620e33c; this executor has NOT updated master. Runtime diff vs production is exactly3files: runtime-environment.js, session-handoff-deployment-policy.js, session-handoff-gateway.js (14insertions/7deletions). Source/idle/core/API routes unchanged. Actual etest sourcea309862 and enabled reserved-account handoff were observed at2026-10-25T23:13:56Z.

Same-SHA source CI: Cloud Sync40243050345 PASS (backend806contracts, lint/build, staging admission); Pages40243050352 PASS; read-only staging admission40243050357 PASS. Local completion12/12 PASS. Etest ordinary3-profile account browser job121319952325 PASS, M3 relay40243444339 PASS, safe V4 merge/writeback40243444415 PASS.

Live completion40243444287: BOTH unmastered and complete cases proved last actual word, visible result, actual binary Blob hash, first revision1, five-more5words, no duplicate extension after reload, actual upload statuses[200,200] and revision2. Both then FAILED fresh-profile login/readback because data-account-entry remained hidden after auth200. Cleanup200 verified for both. This is NOT a complete2/2 pass and is NOT established as503. Three-device40243444312 attempt1 similarly failed post-login application mount: counts[2,1,1], no pending journals, cleanup200. Attempt2 rerun remains unqualified. First UI failure precedes concurrent UI merge, so cannot be attributed wholesale to deployment drift.

History40243444319 attempts1and2 both reproduced direct503/v4_direct_body_read_failed before first revision. Login200/local six-table equality/cleanup200 proven. Transport40243444245 attempt1 failed legacy body503/request_body_unavailable; attempt2 passed fresh/stale V4, second-account isolation, legacy-to-binary migration/SHA/idempotence, then failed direct503/v4_direct_body_read_failed; cleanup PASS. Original failures retained. No further blind rerolls. Release-ready was skipped after transport failure, NOT passed.

Handoff40243444497 functional drain/revocation/union/relogin checks passed; final DELETE503/request_body_unavailable means overall FAILED and cleanup unconfirmed. Pilot remains staging-only in this candidate. Idle40243444346 functional steps passed but cleanup was unconfirmed with no status evidence; DO NOT label that failure503. One independent local Chrome run, same actual source, with sanitized HTTP phase capture passed all steps and DELETE200/accountDeleted=true; evidence attached. It does not erase the first unconfirmed account cleanup.

While these runs were executing another executor merged PR43 and advanced main/etest to b927b31a at2026-10-26T07:18:12+08:00 (new account dropdown and mobile manual sync, not currently released). t.smhe.cn subsequently servesb927b31; production still9620e33c. A local diagnostic stopped at the source-SHA assertion BEFORE account creation. Do not overwrite the new UI branch or count mixed-deployment evidence as exact-SHA acceptance. Current owner scope still excludes unrelated new unreleased UI.

Pending owner reply: allow messaging thread 比较存储一致性方案 to coordinate a fixed etest window and temporarily validate the independent production candidate, restoring its test version afterward; or wait for that thread. No cross-thread message sent without authorization. Once coordinated: preserve latest shared refs, isolate production source, diagnose non503 fresh-profile mount with redacted DOM/startup state, retain exact source gates and typed503 exception. Do not publish until the non503 issue is resolved/qualified.

## Owner decision: preserve current etest and wait (2026-10-26)

Owner selected: preserve current etest; wait until the other thread finishes before continuing release. Do NOT message the other thread to stop, interrupt it, or replace its test deployment while it is working. Previous request for coordination authorization is resolved by this choice. Keep master unchanged until fixed-version qualification and the non503 fresh-profile login/mount failure are resolved. Once the other thread has actually completed, refresh branch/source evidence and resume the already authorized independent release, preserving unrelated work and the etest-only experiment. A quiet thread follow-up may check completion; no unchanged-status notifications.
