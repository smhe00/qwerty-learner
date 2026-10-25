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

## Actual real-Blob result

Qualified commit2543911efd236a5bf43d68e9aee8bd7228d92b40, workflow40159814798
**SUCCESS**: scope job121068818324, exact staging discovery121068918426,
real lifecycle121068979847. Discovery examined2 projects, matched exactly1
etest binding and attempted no writes. CI's existing credential works; earlier
local/no-control-plane access observations must not be presented as proof that
all private execution paths are unavailable.

All8 real-Blob scenarios PASS. Finally cleanup verified all69 tracked keys
individually through the second SDK client and observed an empty run prefix:
failures0, remaining0, confirmed=true. No actual account API or production store
was used. Injected interruption/time are test-only; actual storage IO and the
production cleanup engine were real. This remains one-runner external SDK
coverage, not multi-region/deployed-function qualification. Keep the result's
explicit false coverage flags intact.

Next reachable verification uses the same private CI control-plane path on
staging only: snapshot two nonsecret IDLE parameters BEFORE writes; temporarily
activate with current UTC time (all existing accounts protected180 days); real
Chromium login, hold the independent maintenance request, learn a word, release
it to the real server, verify session/local rows and no eligible deletion;
fresh disposable-account cleanup; restore original settings and observe public
runtime policy disabled again. A separate always-run step verifies restoration.
No production changes, public test routes or Maker deployment. Settings/rollback
guards locally PASS7/7: denied prod IDs, no unrelated or secret setting in
snapshot, exact restore/absent-key deletion, lost ACK readback, concurrent-change
refusal, tamper/backdate rejection. No source/application changes are needed.

Staging-trigger candidate54cd45d8772756fa62e7d6eebd05e344807a40cc did not start:
run40161005208 failed workflow validation with zero jobs. Job-level env does not
permit runner.temp context. No staging settings or test accounts were touched.
Corrected only temporary-directory declarations/artifact references. Installed
official actionlint1.7.12 in /tmp after checksum verification; it reproduces
both original invalid-context diagnostics, and both corrected qualification
workflows pass. Original YAML parsing alone was insufficient. Node20 native
Playwright/retry-policy imports and7/7 setting guards already passed. Requalify
this actual staging path with the fixed workflow; do not relabel the failed run.

Corrected workflowde64e6dc started real CI40161125235/job121072724078.
Discovery and pre-write snapshot succeeded; original two IDLE keys were absent.
Temporary apply was acknowledged, but runtime policy activation was not observed
within the bounded read-only window. The main run failed at
wait-runtime-policy-activation, with no disposable registration/browser journey
started. Both automatic rollback checks reported restored=false; do NOT report
the staging environment restored yet. Production was not changed.

Repository deployment instructions state environment edits affect subsequent
deployments and require redeploy. This explains why control-plane edits alone
are not proof of runtime activation, but it does not explain the unconfirmed
key rollback. Added a narrowly scoped recovery using the saved absent-key
baseline: read selected known-key shapes/ownership, retry only known-key
deletion with redacted SDK error class/code, verify exact absence, or explicitly
fail closed to empty start date/false execute if provider deletion is unavailable.
Never call that fallback exact absence restoration. No unrelated values, secret
contents, production project or deployment is touched. Finish recovery before
any further staging configuration/deployment experiment. The failed real
trigger run remains a failure;8/8 isolated real-Blob result is separate.

Recovery40161791374 FAIL: current two values matched the test-owned snapshot;
SDK key deletion was rejected with InvalidParameter; an empty-date/false-flag
upsert was rejected with InvalidParameter.Security. The next narrowly changed
recovery40162073663 atf59bef72 SUCCESS: updated only execution=false (no empty
date), canonically confirmed it, and public runtime policy remained disabled.
Exact absent-key baseline was NOT restored: the test-owned valid date remains,
execution is explicitly false. No production change/deployment. Keep both
results and do not call the failed deletion/update operations passes.

The next staging baseline intentionally snapshots these two valid settings;
restoration uses supported nonempty upserts rather than rejected key deletion.
Provider documentation requires new deployments for env changes; SDK deploy is
Upload-project-only and cannot redeploy this GitHub project. Use the normal
authorized staging branch promotions instead: after the separate apply step,
promote the application-identical main candidate; after journey/settings
rollback, promote a report-only child. The runner waits for both source markers
and verifies execution-off using a fresh disposable real API probe (public
enabled may remain true with a retained date, so it is insufficient). Original
phase failures remain recorded. No new production deployment, source change,
clock override or target account aging.
