---
protocol_version: "1.1"
task_id: "TASK-20261011-learn-tail-release"
status: "REVIEW"
executor: "Codex"
release_to_master: true
released_commit: "2fa2a1a351ea2de85a9570afc7aa46cb0a839557"
previous_master: "855d9ae5a4b4b7f8c7d8d4299930a00b9ecf3a58"
---

# Learn tail fix — published release

The human user explicitly requested publication after the implementation report.
Released exactly the reviewed two commits (592fbbb9 implementation, 2fa2a1a3
report) from the prior master baseline 855d9ae5 via normal fast-forward push.
No force push, unrelated feature, login or remote user data operation occurred.
The separate release authorization task was committed only on product/main;
CURRENT_TASK's unrelated executor ownership remains unchanged.

## Deployment and verification

- master: 2fa2a1a351ea2de85a9570afc7aa46cb0a839557.
- Production: https://qwerty-plus.edgeone.dev/.
- Served entry changed from /assets/index-32df52af.js to
  /assets/index-b8cc1363.js; app changed from app-4c8dbc94.js to app-24f0d9c5.js.
- The served app contains source marker 2fa2a1a and no longer contains the
  prior 855d9ae marker. This was checked twice after the deployment completed.
- /api/health returned HTTP 200, ok=true, service=qwerty-sync-gateway.
- Published Learn browser smoke: 2 passed, 0 failed (7.9 seconds), using fresh
  isolated installed Chrome contexts. One real typed Learn word remained
  durable after refresh; repeated reload preserved normalized routes.
- Used production-learn-smoke.config.ts with a temporary channel='chrome'
  override because the pinned bundled Chromium executable is absent locally.
  First launch failed before any browser ran; the installed Chrome rerun passed.
- Existing pre-release evidence: 165 domain/simulation tests, 15 local browser
  Acquisition checks, changed production source lint, development build.
  Full type errors are unchanged from 855d9ae, as recorded in the incident report.

## CI findings and correction

Review Gate for 2fa2a1a failed on one additional legacy assertion in
 tests/review/acquisition-regression.test.ts: it expected cooled Assistance to
 resume Supported with the old hint position. The implementation intentionally
 resumes Independent without the old hint. Updated this test's name and those
 two expectations to the new behavior; its pre-deadline and fresh-quota checks
 remain intact. This test-only follow-up is committed on product/main, without
 another unnecessary master/EdgeOne build. Production source is unchanged.

After that correction, all 207 Review policy/formal/Acquisition and Learn
unit contracts passed locally. Review foundation was bundled separately with
--external:@playwright/test, matching the CI gate, and all 26 foundation tests passed (233 combined). The source-release CI red
status is historical and is not represented as a green CI result.

EdgeOne Production Verify run 38111532496 failed independently with
ResourceNotFound: Makers project(makers-cgemngjuuwle) is not found. It failed
before inspecting a deployment. Actual deployment was verified from the served
source marker and real production browser tests, not from that failed job.
https://github.com/smhe00/qwerty-learner/actions/runs/38111532496

The published dual-site explorer had an unrelated pre-release expectation
failure: '云端同步与账号' expected visible but hidden on the existing production
site. No cloud account UI changes are included in this release. No release
workflow/gate was disabled or weakened.

## Follow-up and rollback

Production is serving the intended fix and the published Learn smoke passed.
The existing initial cooling and failed-probe cooldown remain intentional.
Review the test-only follow-up on product/main; CI configuration repair for the
obsolete Maker project ID is separate work. If rollback becomes necessary,
create a new revert commit for 592fbbb9; never rewrite master to the previous SHA.
