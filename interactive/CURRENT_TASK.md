---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-ACTIVATION-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-ACTIVATION-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md'
target_branch: 'product/main'
status: 'BLOCKED'
executor: 'Codex (single activation executor)'
claim_base_commit: 'c74a59b8f9c1972a2c159a082b8fc04519cfa2c8'
release_to_master: false
runtime_activation_authorized: true
---

Owner now authorized enabling idle cleanup on production. Do not ask for the same authorization again. Activation is not completed: there is no ready Tencent/EdgeOne control-plane credential or tool in this environment, and real isolated Blob interruption/repeated-run qualification remains outstanding. See activation task/report for the concrete prerequisites and continuation procedure. No runtime variables, user data, source defaults or production branch changed.

Latest public policy observation remains `{ok:true,enabled:false,idleDays:180}`. Important: this endpoint's enabled field reports valid IDLE_POLICY_START_AT configuration, not IDLE_CLEANUP_EXECUTE itself. False prevents execution; true alone would not prove destructive execution is on. Verify actual runtime settings plus administrator dry-run executionEnabled when access is available. Do not log private settings or account-preview data.

Prior release IDLE-ACCOUNT-RELEASE-20261025 remains complete at REVIEW: master/etest5528f79c, product/main report/test checkpointc74a59b8. Prior reports/evidence are preserved. PR17 inspection is complete, Circle implementation remains postponed. Never enable cleanup by bypassing the server environment switches or by moving activation date backwards.
