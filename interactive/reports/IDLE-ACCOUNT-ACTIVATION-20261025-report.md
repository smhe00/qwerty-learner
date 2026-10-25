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

Coordinated forward candidatead092c7348260407c0c91102073c5447fffeee07,
CI40162681151/job121077341812: pre-write snapshot and separate apply step
SUCCESS. Original snapshot now contains the retained valid date and explicit
false execution flag, so exact restore uses supported nonempty upserts. Normal
non-force staging promotion5528f79c ->ad092c73 succeeded after verifying actual
remote refs and byte-identical src/cloud-functions/build inputs. Production
master remains5528f79c. The runner waits for exactad092c73 deployment before
asserting active policy or creating a browser test account. Next: observe the
browser result and control-plane restore; then commit/promote a report-only
child so the disabled setting reaches runtime. Do not leave it at the forward
deployment or claim restoration merely from project metadata.

## Runtime configuration defect found by actual deployment

Forwardad092c73 did become the live frontend source. CI40162681151 nonetheless
failed wait-runtime-policy-activation, before registration. Control-plane
rollback then succeeded (exact current valid-date/false baseline); independent
restore was a no-op confirmation. The final source-rollback wait timed out;
that run is FAILED, never a browser/learning pass. No new test account from it.
Preserve its intermediate/final receipts separately.

Source inspection found onRequest destructured only context.env. The fix reads
the four ADMIN/IDLE settings from Node process.env (also with literal accesses
for provider injection), with explicit context overrides/undefined fallback.
It intentionally does NOT activate unrelated Node Blob-name/CORS/sync settings
or change Circle routing. Public policy retains enabled=date-configured and
adds executionEnabled=effective automatic execution permission; health gains
idle-runtime-policy-v1. No dates, passwords or account details are exposed.

Local relevant backend/storage/auth/privacy contracts PASS94/94. Actual
Node20.18.0 feature/rollback contracts PASS15/15; includes context-null/absent,
explicit false/empty override, exact true/date gate, Node administrator password
used instead of default, provider compile-time binding and unrelated-setting
isolation. A bundler test initially inherited ES5 from frontend tsconfig;
setting its actual Node20 target fixed the harness without removing assertions.
Scoped lint/actionlint PASS. Frontend production build PASS15.85s with existing
bundle warnings; yarn is absent locally, so equivalent npm-run build was used.
No TypeScript source changed; do not claim a newly green full TypeScript check.

Deploy the fix first with current execution=false; then initiate an explicit
tagged report-only qualification child to avoid automatically applying live
settings while the fix itself is still rolling out. Updated preflight checks
executionEnabled rather than the date-only flag, captures actual staging ref
through GitHub's read token, and canonically verifies config write values
before any promotion. Subsequent runtime-on browser test and rollback source
proof remain outstanding, as does geographic coverage. No production change.

Runtime fix697f284faae1b17be34bfb0217b87cc143f98a89 was fast-forwarded to
staging with explicit execution=false. Actual marker697f284 and new health
capability prove the new code arrived, but /account-policy still reports
enabled=false/executionEnabled=false. Therefore the compatibility patch alone
has NOT established binding of the retained valid project date; do not claim
the root cause solved or start more registration tests yet. Main Cloud Sync
Gate40164562698 SUCCESS; the automatic trigger workflow was intentionally
SKIPPED, not a live pass. Production master unchanged.

Added a read-only exact-project metadata audit via the same official SDK
Describe actions used by public list/get methods, inspecting raw field names
and safe scope enums that EnvVar normalization discards. Compare supported
china/global control-plane reads; output only selected IDLE key presence,
date-parseability and disabled-flag booleans, never values/IDs/credentials.
This audit mutates no configuration/storage or deployment. Its purpose is to
resolve project-variable vs Cloud Function binding rather than guess another
configuration write. Syntax/scoped lint/actionlint passed before execution.

Read-only audits40165178329 and40165360908 both succeeded. Global control
plane confirms both IDLE records cover Production and Preview, date is valid,
execution=false. China endpoint unavailable. These are configuration metadata
observations, not a live binding pass. Added a temporary method-specific GET
probe to distinguish plain/map/Node binding, emitting types/booleans only and
an allowlisted region. Privacy/shape contracts PASS2/2 on Node20, scoped lint
and diff whitespace checks PASS. SDK audit also checks exact custom-domain
and branch correspondence without emitting private domain lists or values.
Staging promotion is necessary for this runtime ABI diagnosis. Production
master remains5528f79c; no operator/real account used.

Audit40166504186 establishes a concrete discovery defect: the selected
project has the old etest.edgeone.dev preset and expected repository branch,
but NO t.smhe.cn custom domain. Independently, the old preset servesb1962e2,
while t.smhe.cn serves697f284. The SDK's normalized Project drops custom
domains, and our discovery accepted the old preset as sufficient. Earlier
“exact staging” claims are therefore not established for the current t.smhe.cn
backend; the isolated random-store tests remain useful but do not certify
that backend. No further configuration writes until raw catalog domain
correspondence is established. Added read-only booleans across all accessible
projects, including formerly denied IDs for reads only. All deny-write guards
remain unchanged. Temporary writes so far affected only the old preset
project; execution=false is confirmed there. Production remains untouched.

Correction before further writes: the first raw project audit used unsupported
ProjectIds instead of Filters and selected the first returned record; catalog
rows consequently repeated. Its domain/branch conclusions above are NOT
established. Exact environment record checks use the correct ProjectId input
and remain valid. Fixed project reads to use the SDK's exact documented
Filters shape and assert the returned ProjectId matches before inspecting.
Strengthened discovery to require passed t.smhe.cn binding and staging branch,
never an old preset alone. Local binding/namespace guard contracts PASS9/9.
Re-run the corrected read-only audit before concluding project mismatch.

Corrected exact-ID audit40166715518 SUCCESS confirms the accessible global
catalog has2 projects, neither reports t.smhe.cn/q.smhe.cn custom bindings.
This now uses Filters and finds the exact returned ProjectId. The formerly
selected staging project has the old preset and valid date/false metadata;
the other known ID does NOT have IDLE settings. Current-domain discovery
40166671946 failed with0 matches; isolated-suite40166671952 passed scope9/9,
then correctly refused discovery and SKIPPED all real Blob writes. This is
an unresolved provider project/binding/access mismatch, not a claim the
domains do not exist or that China access is definitively unauthorized.

Actual t.smhe.cn now serves5fa7574. Read-only method-specific probe HTTP200
reports context is a plain object, both context and Node date bindings are
undefined, no map-shaped API, function region ap-hongkong. This rules out
the generic handler/Map-vs-object hypothesis for this observed deployment.
Production q.smhe.cn still reports enabled=false at5528f79c. Never start a
new enabled runtime experiment until actual domain/project correspondence
and configuration reachability are established. Added safe HTTP status and
transport-type metadata to identify why the China API read is unavailable;
no error messages/payloads or credential values are emitted.

Regional audit40167008507 confirms China API is reachable but returns
provider code109/authentication error for the existing CI token, HTTP200;
this is not a network timeout. Global reads succeed. Pinned SDK0.1.0 is the
current npm version. Inspected official edgeone CLI1.6.46 source: it additionally
uses DescribePagesEnvironments for custom environment slugs and domain/branch
bindings, which the SDK's legacy Project normalization does not expose. Added
that official read API to the audit before declaring the current projects
inaccessible. A legacy project's missing CustomDomains alone is insufficient
to exclude a current environment. No configuration writes pending that result.
The CLI also establishes why SDK deleteEnvs failed: backend expects EnvVars
objects (Id/Key/Value), while SDK sends key strings. This is now a concrete
path to remove only our two historical temporary records if needed.

Custom-environment audit40167108988 SUCCESS: both accessible global projects
have only default Production/Preview environments; neither environment reports
the current domains. The current staging branch is in the selected project's
Production environment; the other project's Production lists master. Thus
custom environment scope does not explain the missing current-domain mapping
in this accessible catalog. China API code109/authentication failure remains.
Do not infer actual China project identity without access or operator metadata.

Prepared exact cleanup of our historical temporary configuration using the
immutable original rollback receipt from40161125235, fixed original project,
fixed activation timestamp, original=[] and exact disabled values/default
scopes. Official CLI delete shape removes only matching Id/Key/Value records;
reject changed values, custom scope, duplicates or different receipts before
any deletion. Lost ACK requires canonical absence; repeated run is safe. Local
Node20 ownership/foreign-project/concurrent-change/ACK contracts PASS4/4;
scoped lint/actionlint/diff checks PASS. Runner never logs settings values,
IDs or unrelated parameters. This restores original absence, not activation.
