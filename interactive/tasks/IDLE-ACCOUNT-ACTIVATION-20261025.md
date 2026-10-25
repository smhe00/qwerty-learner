---
task_id: IDLE-ACCOUNT-ACTIVATION-20261025
status: PARTIAL
target_branch: product/main
base_commit: c74a59b8f9c1972a2c159a082b8fc04519cfa2c8
allow_parallel_executors: false
release_to_master: false
cleanup_release_authorized: true
runtime_activation_authorized: true
report_file: interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md
---

# Enable idle cleanup after actual deployed-path verification

## Latest owner correction — implement code-managed activation

Owner explicitly instructed “你应该修改代码，让代码运行”, rejecting manual
console configuration as the task. Implement code deployment activation with
no new API Token/secret/control-plane login. This supersedes our earlier local
restriction against source-managed activation and manual-console resume steps.
Normal release authorization already exists; keep all same-SHA release gates.

Release policy defaults automatic execution on; first executing independent
maintenance persists its own per-project UTC activation in existing Blob with
conditional creation/canonical confirmation. Existing accounts receive full
180 days from that floor. Login/public policy/preview never initialize it;
preview is read-only. Deployments never intentionally rewrite it; invalid or
unconfirmed metadata holds deletion. Explicit environment stop remains an
optional override; source enabled=false provides normal code rollback. Keep
identity-last deletion, daily best effort, bounded work, return cancellation,
admin/SMHE exemption, Circle holds and local-data preservation.

Validate automatic boundary/restarts/failed init/lost ACK/overlap/read-only
preview/source and env stops; existing backend/storage/auth safety contracts;
no-control-plane actual staging login/learning/maintenance path with synthetic
accounts and verified cleanup. Then same-SHA published Pages/etest/release-ready
before authorized production promotion. Never age real accounts or add a public
clock endpoint. Do not re-ask user authorization or delegate console setup.

Historical SDK/manual-console investigation follows for audit only.

Owner authorized activation and then instructed “那你自己可以开始验证吧”.
Authorization persists; do not ask again. Scope includes isolated synthetic
Blob fixtures, necessary normal staging rebuilds/reversible settings and a
read-only binding diagnostic route. No public clock/mutation test API, aged
customer fixture, production branch bypass, owner password read or Circle work.
Production advancement, if needed, retains existing same-SHA Pages/etest/
release-ready gates. This phase does not skip them.

## Qualified result and remaining production scope

- Normal code deployment activates cleanup with no owner configuration.
- Actual staging9620e33c/credential-free journey40233323105 SUCCESS.
- Exact-SHA Cloud/Pages/real browser+Blob/release-ready/hard3device all pass.
- Node20 backend802/802, local browser2/2, build/lint/actionlint pass.
- Production remains5528f79c/off. Combined candidate contains SESSION-HANDOFF
  pilot whose independent task explicitly says no master release. Do not
  implicitly ship it via cleanup authorization. Prepare/qualify an appropriately
  isolated production release or await that pilot's approved release scope;
  retain cleanup authorization and all exact-SHA release gates.
- Preserve extra failures40233323142 (functional checks pass, synthetic cleanup
  typed503/refused, overall fail) and40233323110 (history revision0 vs1,
  unresolved root cause, synthetic cleanup confirmed). Do not claim all CI green.

Do not ask the owner for a Token, GitHub Secret, console login/configuration or
renewed cleanup permission. Superseded manual-console/SDK assumptions are
historical in the report, not prerequisites. Both sites use China-console
projects; that fact does not imply the agent needs control-plane access.
