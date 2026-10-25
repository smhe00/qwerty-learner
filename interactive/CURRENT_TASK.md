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

Owner authorized enabling idle cleanup, then explicitly instructed starting verification. Do not re-ask either permission. Production activation is not completed. Real isolated Blob lifecycle qualification now PASS8/8 at2543911e, CI40159814798,69 tracked fixture keys confirmed absent. Exact staging discovery and the CI credential work; do not confuse local credential absence with unavailable CI access. See retained redacted evidence in the activation report.

Next verification is the actual staging browser/maintenance path, with a pre-write rollback snapshot of only the two nonsecret IDLE settings. Temporarily use a fresh UTC activation floor, hold the independent maintenance request while login/learning complete, then verify real server response and restore old settings. Production IDs, backdated/tampered snapshots and concurrent operator changes are refused. Guard tests PASS7/7 on actual Node20. No production configuration change, Maker deployment or new API/test-clock endpoint. Geographic/multi-region coverage remains explicitly unqualified.

Latest public policy observation remains `{ok:true,enabled:false,idleDays:180}`. Important: this endpoint's enabled field reports valid IDLE_POLICY_START_AT configuration, not IDLE_CLEANUP_EXECUTE itself. False prevents execution; true alone would not prove destructive execution is on. Verify actual runtime settings plus administrator dry-run executionEnabled when access is available. Do not log private settings or account-preview data.

Prior release IDLE-ACCOUNT-RELEASE-20261025 remains complete at REVIEW: master/etest5528f79c, product/main report/test checkpointc74a59b8. Prior reports/evidence are preserved. PR17 inspection is complete, Circle implementation remains postponed. Never enable cleanup by bypassing the server environment switches or by moving activation date backwards.
