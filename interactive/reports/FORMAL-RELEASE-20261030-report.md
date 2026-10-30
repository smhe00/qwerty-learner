---
protocol_version: '1.1'
task_id: FORMAL-RELEASE-20261030
status: REVIEW
executor: Codex-release
target_branch: master
claim_base_commit: 0d4d336bb396b59158824d5190faaf1b0131b6ed
source_commit: 7eb3631f1614c8c78352a13bcbcae84ba165a290
previous_master: f874b146875c507f6f30097059a47bb700c761bf
release_to_master: true
---
# Qualified etest promotion to production

**Completed:** master and etest both point to 7eb3631f1614c8c78352a13bcbcae84ba165a290. Actual q.smhe.cn deployment marker, gateway and mobile-route verification PASS. Production confirmation was logged at 2026-10-30 15:21:46 Asia/Shanghai.

Owner explicitly authorized publishing the current etest version to master. Frozen candidate: **7eb3631f1614c8c78352a13bcbcae84ba165a290**. No application source is modified for release. Newer main development is preserved; the responsive-desktop return change in 0d4d336b is outside this already-qualified etest candidate.

## Qualification observed before promotion

| Evidence | Result | Exact-source run |
| --- | --- | --- |
| Published Pages + production UI/CSS matrix | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41015418396 |
| Source Cloud Sync Gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41015418362 |
| Staging admission | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41015418357 |
| S1 Workspace Browser Gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41015418342 |
| Actual etest three-browser S1 and V4/Blob transport (including lost ACK proof) | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41016547420 |
| Hard three-device offline convergence | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/41016547611 |
| release-ready | PASS | Same Cloud workflow, job 123938681645 |

The release-ready log records sameCommit=7eb3631f1614c8c78352a13bcbcae84ba165a290, passedPagesRun=41015418396, sourceCloudRun=41015418362, cloudWorkflowRun=41016547420 and hardThreeDeviceE2ERun=41016547611. Its releaseAuthorized=false is the intentional statement that CI does not grant release permission; the owner's present explicit request supplies that authorization.

All eight etest workflows for this SHA completed successfully: ordinary S1/V4, single-session relay, hard three-device convergence, historical full V4 login, segmented history resume, Learn completion, account cleanup and deployed-code automatic cleanup. Main-source feedback, startup recovery, P4b, Review, Learn, Mobile P0 and published dual-site checks also passed. Pages Explorer was cancelled; it is not substituted for the successful mandatory Pages deployment/regression and published dual-site checks.

Fresh GitHub comparison: master f874b146 is an ancestor of candidate (13 commits ahead); candidate is an ancestor of main 0d4d336b (3 commits ahead). Latest main is not the release source; its cancelled Pages/failing admission results do not substitute for or revoke historical exact-candidate passing evidence.

## Execution and verification

Documentation checkpoint on main precedes promotion. Next: re-read master/etest refs, fast-forward master with expected_sha=f874b146875c507f6f30097059a47bb700c761bf to the fixed candidate, then wait for the automatic EdgeOne Production Verify workflow on the same SHA. That workflow checks the actual q.smhe.cn marker, healthy gateway and /mobile, /mobile/history, /mobile/data and /mobile/achievements entries using anonymous read-only requests.

The execution environment is explicitly unavailable. No fresh local browser/build/test execution is claimed. Existing matching-SHA CI evidence was inspected directly through GitHub, including successful release-ready logs. The existing production verification workflow provides independent deployed-source/health/route evidence without changing the application or using private credentials. Real privileged admin login and physical-device smoke are not newly exercised in this release step.

Master has not yet moved at this checkpoint. No force-push, etest movement, user-data operation, CURRENT_TASK change or production configuration edit.

Main advanced during report preparation from 0d4d336b to 983cce1b (responsive touch/mouse behavior). The first expected-SHA update was rejected; re-read confirmed master/etest unchanged. Rebased only these two new release documents on 983cce1b, preserving all incoming files without application edits. Frozen release source remains 7eb3631f.

## Completed production release

- Fast-forwarded master once from f874b146875c507f6f30097059a47bb700c761bf to exact qualified etest SHA 7eb3631f1614c8c78352a13bcbcae84ba165a290 using expected-head protection and force=false. No release-only source commit, partial cherry-pick, etest update or history rewrite.
- [EdgeOne Production Verify](https://github.com/smhe00/qwerty-learner/actions/runs/41019156185) **PASS**, exact head_sha=7eb3631f1614c8c78352a13bcbcae84ba165a290. Job 123942256391 waited while production served f874b14, then logged result=PASS, deployed=7eb3631, gateway=qwerty-sync-gateway, apiVersion=1 and verificationMode=anonymous-read-only. Confirmed HTTP/app entry for /mobile, /mobile/history, /mobile/data and /mobile/achievements, after matching the actual new source marker. This is deployed-source/HTTP/gateway smoke, not a claim of privileged admin interaction or full physical-device browser QA.
- [Maker V4 Migration Live Readiness](https://github.com/smhe00/qwerty-learner/actions/runs/41019156074) also **PASS**. Its disposable-browser read-only S1 admission check requires the backup checkbox/default-disabled action and preserves its synthetic local row; no production login/cloud write.
- Final fresh refs: master=etest=7eb3631f1614c8c78352a13bcbcae84ba165a290; main=e4d7d36202907a08d79c50339083a55c533f472d before this final documentation update. Newer responsive touch/mouse development remains on main and is not included in this etest-to-master release.
- The current execution environment stayed unavailable. No new local command, build or private-user test is represented as passing. Exact-source historical qualification and live production verification were inspected through GitHub.

All acceptance criteria for this explicit promotion are complete. No further master move is authorized by this task. Keep prior master f874b146 as an incident reference; no automatic rollback is planned. Main may continue independently; CURRENT_TASK/Circle ownership is unchanged.
