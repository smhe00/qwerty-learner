---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-ACTIVATION-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-ACTIVATION-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md'
target_branch: 'product/main'
status: 'PARTIAL'
executor: 'Codex (single activation executor)'
claim_base_commit: '839957b8a94cb5ca67b8e095571477340de12ee8'
release_to_master: false
cleanup_release_authorized: true
runtime_activation_authorized: true
deployed_staging_sha: '9620e33c845f59d31cba107e14dd30754a8c0ca5'
---

Owner explicitly said to MODIFY CODE so it runs; no owner console changes,
new API Token or GitHub Secret. Implemented and actually running on staging.
Do NOT return to the superseded SDK-only/manual-console plans or ask again.

Nonsecret idle-deployment-policy.js enabled=true. First executing independent
maintenance conditionally creates/canonically confirms maintenance/idle-policy/
v1.json, fixed UTC startedAt, full180-day floor. Later deployments reuse it.
Login/activity/public policy and read-only previews do NOT initialize it.
Invalid/unconfirmed bootstrap stops deletion. Optional explicit env stop remains
honored; source enabled=false stops even if old env=true. Identity-last/fences,
admin/SMHE/Circle holds, budget/cursor and local-data guarantees remain.

Implementation65e1064c + source-identical merge9620e33c preserves staged1059
integration ancestry. Normal pushes to main/etest, no force. Actual test site
serves9620e33, enabled=true/executionEnabled=true/180days. Credential-free real
journey40233323105 SUCCESS: login+learning while maintenance held, real response
COMPLETE, local/session preserved, own disposable account deletion confirmed.
Exact-SHA Cloud40233322119, Pages40233322126, browser/Blob/release-ready
40233323095, hard3device40233323272 all SUCCESS. Local Node20 backend802/802,
browser2/2, build19.71s, lint/actionlint passed. See committed redacted evidence.

Production/master STILL5528f79c/off. Combined candidate contains the independently
owned SESSION-HANDOFF pilot; its task explicitly forbids master release. Do not
publish it incidentally through this cleanup request. Cleanup authorization is
already granted; remaining action is a properly isolated/qualified production
release scope, NOT credentials or console setup. Preserve all release gates.

Additional failures retained: pilot40233323142 functional checks passed but
DELETE got typed503, cleanup refused/unconfirmed and overall FAILED; artifact
passed=true is NOT overall success. Historical40233323110 expected revision1
observed0, cause unresolved; its cleanup confirmed. No new owner login, aged
real account, private data read or public clock/mutation endpoint. Circle
implementation remains postponed. Full report records scope and next actions.
