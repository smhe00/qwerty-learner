---
status: IN_PROGRESS
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

## Owner-directed verification continuation

Owner explicitly instructed beginning verification. Local absence of credentials
does not prove Actions' configured EDGEONE_API_TOKEN is unavailable. Existing
SDK-only Circle sandbox runs demonstrate that this is a legitimate private
credential path without local extraction. A dispatch of the old read-only
discovery workflow failed422 because its historical feature branch was deleted;
no cloud action occurred. Do not reuse obsolete project IDs or deploy a test API.

Added a current main-branch qualification workflow: namespace contracts, official
SDK read-only exact etest-domain discovery, then real lifecycle test on dedicated
qwerty-idle-qualification Store plus per-run/per-case random prefixes. Production
and obsolete Maker IDs are denied. No Maker build, production API call, account
creation, real-user metadata mutation or runtime-setting change. CI retains the
token internally. Discovery failures fail the workflow before Blob writes.

Eight scenarios call the unchanged production idle engine: activation floor and
180-day boundary/dry run; drain and identity-last deletion; returning-user
cancellation; a real delete followed by injected lost ACK and a fresh-client
resume;35-second injected budget and next-day continuation; active/admin/SMHE/
Circle protection; two independent SDK workers and daily repeat/username reuse;
foreign-listing refusal. Failures are not retried until green: only defined
bounded interruption/next-day scenarios and existing idempotent storage retries.

Every attempted write is ledgered before dispatch; finally cleanup deletes only
known fixture keys, verifies every exact key through the second client and checks
the run prefix. An untracked residual is a failure, never swept with a wildcard.
Artifact ledger contains only synthetic sandbox keys/nonsecret project metadata,
no credentials or customer data. Reports/logs contain fixed phases/counts only.

Local scope/runner contracts PASS5/5, including the full8-case in-memory runner
self-test. This is NOT the live-Blob result. Scoped ESM lint, Node syntax and YAML
structure checks pass. Official Makers SDK0.1.0 native ESM import and the runner
contracts also execute on actual Node20.18.0. Initial lint sort and SDK import
mode issues were corrected before CI. Temporary npm installation initially used
an unwritable default cache; corrected to /tmp. No qualification cloud call yet.

Real SDK qualification covers the external SDK path and two clients; its report
explicitly sets multiRegionQualified=false/deployedFunctionTested=false. Do not
declare multi-region qualification from one Actions runner or turn production
execution on solely because this limited live suite passes. Record concrete
remaining coverage/access after observing the actual CI result.
