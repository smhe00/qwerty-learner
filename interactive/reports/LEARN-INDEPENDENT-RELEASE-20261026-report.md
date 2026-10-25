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
