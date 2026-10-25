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

Next verification is the actual staging browser/maintenance path. The config-only attempt40161125235 failed before registration: project env changes require redeployment. SDK deletion/empty-date rollback failed; recovery40162073663 succeeded by explicitly setting execute=false and retaining the owned date. No original absent-key equivalence is claimed. Current runtime remains unconfigured/off; future builds load retained date plus execute=false.

Current harness now snapshots those two valid settings, applies a fresh UTC date/true, then waits for an application-identical main -> edgeone-test promotion. After browser journey, control-plane settings restore to the captured date/false; promote a report-only child to edgeone-test so runtime reloads the disabled flag. The CI confirmation waits for that later exact branch/source marker and tests POST maintenance=disabled with a fresh disposable account, then deletes it. Owner's verification authorization covers these necessary normal staging rebuilds, not production changes. Do not ask again. Preserve failed runs; no new test API/clock override. Guard tests7/7 and actionlint passed; global/multi-region coverage remains explicitly unqualified.

New actual finding: coordinated forwardad092c73 did deploy, yet40162681151 failed at runtime-policy activation before any registration. Control-plane rollback succeeded; later source-confirmation timed out. The handler read only context.env, missing Node/server-bundled settings. A narrowly scoped resolver for only ADMIN/IDLE keys, explicit executionEnabled status and runtime capability is now locally qualified94/94, Node20 feature/rollback15/15, frontend build and lint/actionlint. Storage/CORS/sync settings and Circle code remain unchanged. Deploy the fix to staging with execution=false first; then create a report-only child with commit message [idle-live-qualification] to start the actual enabled-path experiment, promote that child after apply success, and promote another report-only child after rollback. Do not mark an all-skipped automatic workflow a live pass. Production remains5528f79c/off until this fix is fully qualified.

Latest:697f284f deployed to staging, health has idle-runtime-policy-v1, but public enabled=false/executionEnabled=false despite the retained valid control-plane date. The Node compatibility fix alone has not qualified actual binding. Do NOT start another tagged on-test yet. Added a read-only binding audit for the exact staging project across supported SDK control-plane regions, emitting field names/scope metadata and date-valid/false booleans only. No values, secrets, settings changes or deployments. Investigate actual platform env binding before further mutation; code's backend environment behavior remains unqualified live. Master stays5528f79c.

Latest public policy observation remains `{ok:true,enabled:false,idleDays:180}`. Important: this endpoint's enabled field reports valid IDLE_POLICY_START_AT configuration, not IDLE_CLEANUP_EXECUTE itself. False prevents execution; true alone would not prove destructive execution is on. Verify actual runtime settings plus administrator dry-run executionEnabled when access is available. Do not log private settings or account-preview data.

Prior release IDLE-ACCOUNT-RELEASE-20261025 remains complete at REVIEW: master/etest5528f79c, product/main report/test checkpointc74a59b8. Prior reports/evidence are preserved. PR17 inspection is complete, Circle implementation remains postponed. Never enable cleanup by bypassing the server environment switches or by moving activation date backwards.
