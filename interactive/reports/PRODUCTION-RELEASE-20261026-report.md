# Production release — 2026-10-26

Status: MASTER PROMOTED; actual production deployment verification is pending at this checkpoint.
Release executor: Chat. This is an independent release receipt; other executors' CURRENT_TASK and task history remain intact.

## Authorization and exact artifact

Owner explicitly instructed: 排除偶发503，可以发布正式版了. Occasional transient HTTP503 is not, by itself, a release veto. This does not authorize deleting failed evidence, weakening data-preservation assertions, treating unknown commits as safe to replay, or claiming all historical failures have been repaired.

- Released commit: **9620e33c845f59d31cba107e14dd30754a8c0ca5**.
- Previous production reference: **5528f79c700548e174fa153b96ff4599d7326aee**.
- master was advanced without force, with an expected-old-SHA lease; the resulting ref was read back and confirmed.
- edgeone-test remains at the identical released SHA. No staging ref or console setting was changed by this release task.
- At promotion product/main was cd6ac70d68e85763f46d3482743a30a322b03b43, exactly one documentation/evidence-only commit ahead. Its seven changed paths are under interactive/; application, cloud functions, build configuration, workflows and tests are unchanged from the qualified artifact. Publish the tested SHA, not a new runtime candidate merely to include reports.
- No new branch, tag, force push, history rewrite or production region change. edgeone.json remains without a region override; Blob strong-consistency settings are unchanged.

## Release contents and scope

The integrated candidate contains the mobile UI refinement (single achievement header, shared icon-only back control, concise Home/Library/History/Data/Settings copy and honest daily progress), guarded Learn completion/five-more handoff, previously integrated account/transport compatibility changes, and the already authorized code-managed idle-account policy. It is NOT merely a UI-only release relative to the previous production commit.

The account-handoff barrier retains its existing reserved synthetic identity selector, /^qh26[0-9a-f]{24}$/. Ordinary accounts are not enrolled by this release. The selector is not a production-host disable switch: the shipped source still exposes the reserved pilot and reports handoffProductionReady=false. General-user handoff rollout is not claimed or newly enabled. Earlier per-task no-master checkpoints describe their historical scope; this later owner instruction authorizes promotion of the qualified integrated candidate, not expansion of the experimental enrollment.

Idle deployment policy is code-enabled as qualified in staging. The implementation retains a persisted activation floor and 180-day eligibility window, protected administrator accounts and existing deletion safeguards; an explicit invalid/stop environment configuration remains fail-closed. This task does not invoke maintenance against real identities, reset an activation floor, provision a database or migrate production data. The separate idle-task report retains its own scope and evidence.

## Passing evidence checked before promotion

All following release-admission results refer to exact runtime SHA9620e33c:

| Check | Run / job | Result |
| --- | --- | --- |
| Cloud backend contracts, sync lint and production build | 40233322119 / 121289522583 | PASS |
| Exact-SHA Pages and cloud staging admission | 40233322119 / 121289876556 | PASS |
| Actual published Pages SHA and browser regression | 40233322126 / 121289522538 | PASS |
| Real staging browser/account path | 40233323095 / 121289525206 | PASS |
| Real V4 upload, readback, stale conflict and Blob size | 40233323095 / 121289525456 | PASS |
| Same-SHA Pages + staging release readiness | 40233323095 / 121291199185 | PASS |
| Three real Learn devices, offline fork, reauth and automatic reconcile | 40233323272 / 121289525955 | PASS |
| Code-managed idle staging qualification | 40233323105 | PASS, as recorded by its executor |
| Historical six-table login/fork safety, targeted repeat | 40233323110 / 121311291770 | PASS |

Run URLs use https://github.com/smhe00/qwerty-learner/actions/runs/<run-id>.

Only one failed historical-login job was explicitly re-run during this release review. No runtime/test code or assertion was changed and no whole-suite reroll campaign was started.

The repeat's artifact12616977826 was downloaded and independently SHA256-verified:
2a57fd5140a666f395ea8140c53fd13feac64ce916a666e8a2f89b4413367c7c.
Its redacted proof confirms full-V4 ordinary-startup recovery, exact six-table pull, shared references and Unicode preservation, independent completed sessions and UUID references, both forks merged with original archives retained, repeat startup without duplicate writes, mixed legacy M3 publication/M4 adoption without changing legacy rows, anonymous isolation after logout, read-only diagnostics, and HTTP200/verified cleanup of its synthetic account. mergedWordRecords=5.

## Failures and limitations retained, not relabeled

1. Historical-login run40233323110 attempt1/job121289525837 expected revision1 and observed0 after the original local-data equality assertion passed. It did not capture a definitive503/error cause. Artifact12614420685 and the failed attempt remain. Attempt2's success demonstrates the candidate can complete that path, not that the original cause was diagnosed or that the original failed account was automatically recovered.
2. Reserved-handoff run40233323142 had a typed request-body503 during synthetic-account deletion; cleanup was unconfirmed. Functional assertions do not turn that workflow into a full pass. Its existing artifact/report remains unchanged.
3. Earlier Learn completion1059efd evidence includes a successful completion upload followed by a503/pending extra-round startup upload. The known intermittent issue is accepted for this owner-authorized release, not declared eliminated. Never blindly replay an uncertain write.
4. Whole-repository historical diagnostics/advisory jobs are not claimed universally green. Existing UI/browser evidence is Chromium-based, not physical Huawei/iOS certification. No new production data-write campaign was manually launched by this task.

## Post-deployment check

Automatic **EdgeOne Production Verify run40241020114** started on the master push. It anonymously reads q.smhe.cn/source-commit.txt, gateway health/capability, and mobile/history/data/achievements application entries. It makes no authenticated data mutation. At this checkpoint it is still running, so a successful push is not yet being described as confirmed deployment.

Local direct network access could not resolve the relevant hosts; native GitHub Actions evidence is used instead. Record the final verifier verdict before claiming the site is live. This receipt is documentation-only on product/main; do not push it to master merely to change the published version marker.
