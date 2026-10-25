---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-ACTIVATION-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-ACTIVATION-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md'
target_branch: 'product/main'
status: 'IN_PROGRESS'
executor: 'Codex (single activation executor)'
claim_base_commit: 'c74a59b8f9c1972a2c159a082b8fc04519cfa2c8'
release_to_master: false
runtime_activation_authorized: true
---

Owner now authorized enabling idle cleanup on production. Do not ask for the same authorization again. Activation is not completed: there is no ready Tencent/EdgeOne control-plane credential or tool in this environment, and real isolated Blob interruption/repeated-run qualification remains outstanding. See activation task/report for the concrete prerequisites and continuation procedure. No runtime variables, user data, source defaults or production branch changed.

Owner additionally instructed starting verification now. Qualification is in progress using a GitHub Actions runner's existing EDGEONE_API_TOKEN binding, without extracting it locally. Local credential absence does not establish CI credential absence. Add a guarded read-only exact-staging-project discovery and a dedicated random-prefix sandbox lifecycle suite; no production API route, Maker deployment or runtime-setting change. Existing discovery workflow's old branch has been deleted, so its dispatch failed before any cloud action. Use a current, reviewed qualification workflow instead. Report geographic coverage honestly.

Latest public policy observation remains `{ok:true,enabled:false,idleDays:180}`. Important: this endpoint's enabled field reports valid IDLE_POLICY_START_AT configuration, not IDLE_CLEANUP_EXECUTE itself. False prevents execution; true alone would not prove destructive execution is on. Verify actual runtime settings plus administrator dry-run executionEnabled when access is available. Do not log private settings or account-preview data.

Prior release IDLE-ACCOUNT-RELEASE-20261025 remains complete at REVIEW: master/etest5528f79c, product/main report/test checkpointc74a59b8. Prior reports/evidence are preserved. PR17 inspection is complete, Circle implementation remains postponed. Never enable cleanup by bypassing the server environment switches or by moving activation date backwards.
