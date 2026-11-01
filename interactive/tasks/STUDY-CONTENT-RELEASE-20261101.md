---
task_id: STUDY-CONTENT-RELEASE-20261101
status: PASS
executor: Codex
base_commit: c5781c84d5b19a4a8981314ced75326604d0a706
target_branch: product/main
release_to_etest: true
release_to_master: true
---

Owner explicitly requested: 直接更新到etest+master. Promote the reviewed content currently on product/main (216 daily examples, 92 paired images, authoritative Shanghai 2027 JSON unchanged), not a new full-library import. This release authorization overrides the default no-master rule for this task only. Leave the unrelated Circle CURRENT_TASK pointer unchanged.

Application source is already qualified on Pages at c5781c84d5b19a4a8981314ced75326604d0a706, but that exact SHA has no Source Cloud Sync Gate run. The connector cannot manually dispatch workflows, and GitHub's public workflow page is unsigned. Add only this release record and a YAML comment to trigger the existing, unchanged Source Cloud Sync Gate. No application, dictionary, test, dependency, gate assertions or job behavior changes.

Pin the resulting main SHA as one candidate. Source Pages/Cloud checks and isolated eTest deployment/qualification may run concurrently; all must pass for that exact SHA before master advances. This overlaps read-only/source CI with authorized isolated real-Cloud testing; no release gate is waived. Verify branch ancestry and use fast-forward updates with expected heads. Wait for Branch EdgeOne Cloud E2E (live-browser-cloud, real-v4-transport and release-ready), including the hard three-device offline convergence check. Inspect other candidate live test failures and repair genuine regressions if any. Never substitute evidence from another SHA. Then advance master to the IDENTICAL qualified eTest SHA and verify q.smhe.cn actually serves it, plus a visible picture/example card. Do not create a release-only application commit on master or force-push.

Persist exact candidate, workflow evidence, deployed markers and final branch heads in interactive/reports/STUDY-CONTENT-RELEASE-20261101-report.md. Final report-only checkpoint may advance main after promotion; never add it directly to master without requalification.
