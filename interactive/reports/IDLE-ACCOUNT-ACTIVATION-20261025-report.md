---
status: BLOCKED
executor: Codex (single activation executor)
base_commit: c74a59b8f9c1972a2c159a082b8fc04519cfa2c8
runtime_activation_authorized: true
runtime_configuration_changed: false
---

# Production idle activation preflight

Owner authorized activation; do not re-ask that permission when resuming. It is
not completed. This checkpoint changes coordination documents only, not
application code, production branches or runtime settings.

## Evidence

- Anonymous production probe2026-10-25T03:33:31Z returned200
  `{ok:true,enabled:false,idleDays:180}`. Previous release remains deployed.
- Source review: account-policy.enabled is idle.configured (finite policy
  start date). runDaily requires both configured and execute. False prevents
  automatic cleanup, but does not reveal IDLE_CLEANUP_EXECUTE's exact value.
  Earlier conversational wording called this the cleanup switch; that was
  imprecise. Verify actual runtime settings and admin preview executionEnabled
  when activating, not just the public boolean.
- Previous request-body500 qualification and ordinary V4 deletion smoke passed.
  They do not test the real idle-deletion interruption/convergence lifecycle.
  docs/operations/IDLE_ACCOUNT_CLEANUP.md and implementation reports retain
  isolated live-Blob qualification before destructive production activation.
  Existing fake-store/time-injection tests are not that live qualification.
- Current cloud readiness observations are current, with no secret bindings,
  runtime variables or outbound identities. Tool search found no Tencent or
  EdgeOne control-plane capability. Relevant process variable names are absent;
  Tencent CLI is not installed. No credential values or files were read.
- GitHub secret-name and variable-name metadata listing returned403 Resource
  not accessible by integration. This is an API-permission limit, not an
  automatic approval-review rejection or proof no secrets exist.

## Work completed and dependency

Reviewed deployment/source/operations/test evidence and prepared the exact
activation/rollback procedure in the linked task. No unchanged suite rerun,
cloud account creation, administrator login, real deletion, scheduler,
source-default change or control-plane mutation was attempted.

Cannot finish without controlled Tencent/EdgeOne configuration and isolated
Blob qualification access. Use a supported private connection/configured
credential path, or operator console settings after qualification; do not paste
secrets into chat. No additional activation approval is needed.

Next: obtain that access, qualify isolated live lifecycle, configure actual
start date and execution flag, verify them independently. Until then report
**not enabled**. Preserve the prior release and Circle PR17 reports.
